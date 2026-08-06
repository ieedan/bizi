//! Port of the TypeScript TUI's `lib/logs.ts`.
//!
//! Log lines arrive from the server exactly as the underlying process emitted
//! them, so they can contain arbitrary ANSI escape sequences. We decode the SGR
//! subset we can render and drop everything else.

use chrono::{Local, TimeZone};
use unicode_width::{UnicodeWidthChar, UnicodeWidthStr};

const ANSI_16_COLOR_HEX: [&str; 16] = [
    "#000000", "#aa0000", "#00aa00", "#aa5500", "#0000aa", "#aa00aa", "#00aaaa", "#aaaaaa",
    "#555555", "#ff5555", "#55ff55", "#ffff55", "#5555ff", "#ff55ff", "#55ffff", "#ffffff",
];

const BASIC_TERMINAL_COLORS: [&str; 8] = [
    "black", "red", "green", "yellow", "blue", "magenta", "cyan", "white",
];

/// Columns between tab stops when expanding tabs in log output.
const TAB_STOP: usize = 8;

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct LogTextStyle {
    pub fg: Option<String>,
    pub bg: Option<String>,
    pub bold: Option<bool>,
    pub dim: Option<bool>,
    pub italic: Option<bool>,
    pub underline: Option<bool>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParsedLogSegment {
    pub text: String,
    pub style: LogTextStyle,
}

/// Formats the `[task] ` tag that prefixes every aggregated log line, padded to
/// `width` so the log content stays aligned.
pub fn format_task_tag_for_log(task_name: &str, width: usize) -> String {
    let min_width = 4;
    let safe_width = width.max(min_width);
    let inner_width = safe_width.saturating_sub(3).max(1);

    let chars: Vec<char> = task_name.chars().collect();
    let display_task_name = if chars.len() > inner_width {
        let keep = inner_width.saturating_sub(1).max(1);
        let mut truncated: String = chars[..keep.min(chars.len())].iter().collect();
        truncated.push('…');
        truncated
    } else {
        task_name.to_string()
    };

    let mut tag = format!("[{display_task_name}] ");
    while tag.width() < safe_width {
        tag.push(' ');
    }
    tag
}

/// Resolves a user supplied task color into something we can render. Returns
/// `None` for anything that is neither a basic terminal color name nor a hex
/// color, matching the TypeScript implementation.
pub fn resolve_task_log_color(color: Option<&str>) -> Option<String> {
    let trimmed = color.map(str::trim).unwrap_or("");
    if trimmed.is_empty() {
        return None;
    }

    let normalized = trimmed.to_lowercase();
    if BASIC_TERMINAL_COLORS.contains(&normalized.as_str()) {
        return Some(normalized);
    }

    if is_hex_color(trimmed) {
        return Some(normalized);
    }

    None
}

fn is_hex_color(value: &str) -> bool {
    let Some(rest) = value.strip_prefix('#') else {
        return false;
    };
    if rest.len() != 3 && rest.len() != 6 {
        return false;
    }
    rest.chars().all(|character| character.is_ascii_hexdigit())
}

/// Plain-text view of a log line with every escape sequence removed.
#[allow(dead_code)]
pub fn sanitize_log_for_display(line: &str) -> String {
    parse_ansi_log_segments(line)
        .into_iter()
        .map(|segment| segment.text)
        .collect()
}

pub fn parse_ansi_log_segments(line: &str) -> Vec<ParsedLogSegment> {
    let last_carriage_return_chunk = line.rsplit('\r').next().unwrap_or(line);
    let sanitized: Vec<char> = strip_unsupported_terminal_sequences(last_carriage_return_chunk)
        .chars()
        .collect();

    let mut segments: Vec<ParsedLogSegment> = Vec::new();
    let mut current_style = LogTextStyle::default();
    let mut current_text = String::new();
    let mut index = 0usize;

    while index < sanitized.len() {
        let character = sanitized[index];
        if character == '\u{1b}' {
            let next = sanitized.get(index + 1).copied();
            if next == Some('[') {
                let mut cursor = index + 2;
                while cursor < sanitized.len() {
                    let byte = sanitized[cursor] as u32;
                    if (0x40..=0x7e).contains(&byte) {
                        break;
                    }
                    cursor += 1;
                }

                if cursor < sanitized.len() {
                    if sanitized[cursor] == 'm' {
                        flush_segment(&mut segments, &mut current_text, &current_style);
                        let sequence: String = sanitized[index + 2..cursor].iter().collect();
                        apply_sgr_sequence(&sequence, &mut current_style);
                    }
                    index = cursor + 1;
                    continue;
                }
            }

            index += if next.is_some() { 2 } else { 1 };
            continue;
        }

        let code = character as u32;
        if (code < 0x20 || code == 0x7f) && character != '\t' {
            index += 1;
            continue;
        }

        current_text.push(character);
        index += 1;
    }

    flush_segment(&mut segments, &mut current_text, &current_style);
    if segments.is_empty() {
        segments.push(ParsedLogSegment {
            text: String::new(),
            style: LogTextStyle::default(),
        });
    }
    segments
}

fn flush_segment(
    segments: &mut Vec<ParsedLogSegment>,
    current_text: &mut String,
    style: &LogTextStyle,
) {
    if current_text.is_empty() {
        return;
    }
    segments.push(ParsedLogSegment {
        text: std::mem::take(current_text),
        style: style.clone(),
    });
}

/// Replaces tabs with the spaces that reach the next tab stop.
///
/// The parser keeps `\t` so it stays a faithful view of the line, matching the
/// TypeScript client. Expansion belongs here instead: a tab written into a cell
/// counts as one column to us but moves a real terminal to its next tab stop,
/// which desynchronises the renderer from the screen and eats the characters
/// that follow.
fn expand_tabs(segments: Vec<ParsedLogSegment>) -> Vec<ParsedLogSegment> {
    if !segments.iter().any(|segment| segment.text.contains('\t')) {
        return segments;
    }

    let mut visible_column = 0usize;
    segments
        .into_iter()
        .map(|segment| {
            let mut text = String::with_capacity(segment.text.len());
            for character in segment.text.chars() {
                if character == '\t' {
                    let spaces = TAB_STOP - (visible_column % TAB_STOP);
                    text.extend(std::iter::repeat_n(' ', spaces));
                    visible_column += spaces;
                } else {
                    text.push(character);
                    visible_column += display_width(character);
                }
            }
            ParsedLogSegment { text, ..segment }
        })
        .collect()
}

/// Splits a log line into the display rows the log pane renders, word wrapping
/// at `width` columns the way the TypeScript TUI's `<text>` box does. Styling
/// flows across the wrap points, so a colored span split over two rows keeps its
/// color on both.
pub fn wrap_log_line(line: &str, width: usize) -> Vec<Vec<ParsedLogSegment>> {
    let segments = expand_tabs(parse_ansi_log_segments(line));
    let (characters, style_ids) = flatten_segments(&segments);

    wrap_ranges(&characters, width)
        .into_iter()
        .map(|(start, end)| collect_row(&segments, &characters, &style_ids, start, end))
        .collect()
}

/// Number of display rows `wrap_log_line` would produce. Used to lay the log
/// viewport out without materializing rows for lines that are scrolled away.
pub fn count_log_line_rows(line: &str, width: usize) -> usize {
    let segments = expand_tabs(parse_ansi_log_segments(line));
    let (characters, _) = flatten_segments(&segments);
    wrap_ranges(&characters, width).len()
}

fn flatten_segments(segments: &[ParsedLogSegment]) -> (Vec<char>, Vec<usize>) {
    let mut characters = Vec::new();
    let mut style_ids = Vec::new();
    for (index, segment) in segments.iter().enumerate() {
        for character in segment.text.chars() {
            characters.push(character);
            style_ids.push(index);
        }
    }
    (characters, style_ids)
}

fn collect_row(
    segments: &[ParsedLogSegment],
    characters: &[char],
    style_ids: &[usize],
    start: usize,
    end: usize,
) -> Vec<ParsedLogSegment> {
    let mut row: Vec<ParsedLogSegment> = Vec::new();
    for index in start..end {
        let style_id = style_ids[index];
        match row.last_mut() {
            Some(last) if segments[style_id].style == last.style => {
                last.text.push(characters[index])
            }
            _ => row.push(ParsedLogSegment {
                text: characters[index].to_string(),
                style: segments[style_id].style.clone(),
            }),
        }
    }
    row
}

/// Greedy word wrap. Rows are contiguous slices of the original text so nothing
/// is reordered or duplicated; the single space a row breaks on is consumed, and
/// a word longer than `width` is hard broken.
fn wrap_ranges(characters: &[char], width: usize) -> Vec<(usize, usize)> {
    let width = width.max(1);
    if characters.is_empty() {
        return vec![(0, 0)];
    }

    let mut rows = Vec::new();
    let mut row_start = 0usize;
    let mut cursor = 0usize;
    let mut row_width = 0usize;
    let mut last_space: Option<usize> = None;

    while cursor < characters.len() {
        let character_width = display_width(characters[cursor]);
        // `cursor > row_start` keeps every row at least one character wide, so a
        // character wider than the viewport cannot spin the loop forever.
        if row_width + character_width > width && cursor > row_start {
            let (row_end, mut next_start) = match last_space {
                Some(space) if space > row_start => (space, space + 1),
                _ => (cursor, cursor),
            };
            // A row never starts with the whitespace it wrapped on.
            while next_start < characters.len() && characters[next_start] == ' ' {
                next_start += 1;
            }
            rows.push((row_start, row_end));
            row_start = next_start;
            cursor = next_start;
            row_width = 0;
            last_space = None;
            continue;
        }

        if characters[cursor] == ' ' {
            last_space = Some(cursor);
        }
        row_width += character_width;
        cursor += 1;
    }

    if row_start < characters.len() || rows.is_empty() {
        rows.push((row_start, characters.len()));
    }
    rows
}

fn display_width(character: char) -> usize {
    UnicodeWidthChar::width(character).unwrap_or(0).max(1)
}

pub fn format_log_timestamp(timestamp_ms: i64) -> String {
    match Local.timestamp_millis_opt(timestamp_ms).single() {
        Some(date) => format!("{}", date.format("%H:%M:%S%.3f")),
        None => "--:--:--.---".to_string(),
    }
}

pub fn format_elapsed_duration(duration_ms: i64) -> String {
    let safe_duration = duration_ms.max(0);
    if safe_duration < 1000 {
        return format!("{safe_duration}ms");
    }
    if safe_duration < 60_000 {
        return format!("{}s", safe_duration / 1000);
    }
    if safe_duration < 3_600_000 {
        let minutes = safe_duration / 60_000;
        let seconds = (safe_duration % 60_000) / 1000;
        return format!("{minutes}m {seconds}s");
    }
    let hours = safe_duration / 3_600_000;
    let minutes = (safe_duration % 3_600_000) / 60_000;
    format!("{hours}h {minutes}m")
}

/// Removes OSC (`ESC ] … BEL`) and string (`ESC P/X/^/_ … ESC \`) sequences.
fn strip_unsupported_terminal_sequences(line: &str) -> String {
    strip_string_sequences(&strip_osc_sequences(line))
}

fn strip_osc_sequences(line: &str) -> String {
    let chars: Vec<char> = line.chars().collect();
    let mut out = String::new();
    let mut index = 0usize;

    while index < chars.len() {
        if chars[index] == '\u{1b}' && chars.get(index + 1) == Some(&']') {
            // The JavaScript pattern is `\x1b\][^\x07]*(?:\x07|\x1b\\)`. Because
            // the body cannot contain BEL, the match always ends at the first
            // BEL when one exists and otherwise at the first `ESC \`.
            if let Some(terminator) = find_osc_terminator(&chars, index + 2) {
                index = terminator;
                continue;
            }
        }
        out.push(chars[index]);
        index += 1;
    }

    out
}

fn find_osc_terminator(chars: &[char], start: usize) -> Option<usize> {
    let mut string_terminator: Option<usize> = None;
    let mut cursor = start;
    while cursor < chars.len() {
        if chars[cursor] == '\u{7}' {
            return Some(cursor + 1);
        }
        if string_terminator.is_none()
            && chars[cursor] == '\u{1b}'
            && chars.get(cursor + 1) == Some(&'\\')
        {
            string_terminator = Some(cursor + 2);
        }
        cursor += 1;
    }
    string_terminator
}

fn strip_string_sequences(line: &str) -> String {
    let chars: Vec<char> = line.chars().collect();
    let mut out = String::new();
    let mut index = 0usize;

    while index < chars.len() {
        if chars[index] == '\u{1b}'
            && matches!(
                chars.get(index + 1),
                Some('P') | Some('X') | Some('^') | Some('_')
            )
        {
            let mut cursor = index + 2;
            let mut terminator: Option<usize> = None;
            while cursor < chars.len() {
                if chars[cursor] == '\u{1b}' && chars.get(cursor + 1) == Some(&'\\') {
                    terminator = Some(cursor + 2);
                    break;
                }
                cursor += 1;
            }
            if let Some(end) = terminator {
                index = end;
                continue;
            }
        }
        out.push(chars[index]);
        index += 1;
    }

    out
}

fn apply_sgr_sequence(sequence: &str, style: &mut LogTextStyle) {
    let raw_values: Vec<&str> = if sequence.is_empty() {
        vec!["0"]
    } else {
        sequence.split(';').collect()
    };

    let mut index = 0usize;
    while index < raw_values.len() {
        let Ok(code) = raw_values[index].parse::<i64>() else {
            index += 1;
            continue;
        };

        if code == 38 || code == 48 {
            let is_foreground = code == 38;
            let mode = raw_values
                .get(index + 1)
                .and_then(|value| value.parse::<i64>().ok());

            if mode == Some(5) {
                let color_index = raw_values
                    .get(index + 2)
                    .and_then(|value| value.parse::<i64>().ok());
                if let Some(color) = color_index.and_then(to_ansi_256_color) {
                    set_channel(style, is_foreground, Some(color));
                }
                index += 3;
                continue;
            }

            if mode == Some(2) {
                let red = raw_values
                    .get(index + 2)
                    .and_then(|value| value.parse::<i64>().ok());
                let green = raw_values
                    .get(index + 3)
                    .and_then(|value| value.parse::<i64>().ok());
                let blue = raw_values
                    .get(index + 4)
                    .and_then(|value| value.parse::<i64>().ok());
                if let (Some(red), Some(green), Some(blue)) = (red, green, blue)
                    && is_valid_rgb_channel(red)
                    && is_valid_rgb_channel(green)
                    && is_valid_rgb_channel(blue)
                {
                    set_channel(style, is_foreground, Some(rgb_to_hex(red, green, blue)));
                }
                index += 5;
                continue;
            }
        }

        match code {
            0 => *style = LogTextStyle::default(),
            1 => {
                style.bold = Some(true);
                style.dim = Some(false);
            }
            2 => {
                style.dim = Some(true);
                style.bold = Some(false);
            }
            3 => style.italic = Some(true),
            4 => style.underline = Some(true),
            22 => {
                style.bold = None;
                style.dim = None;
            }
            23 => style.italic = None,
            24 => style.underline = None,
            39 => style.fg = None,
            49 => style.bg = None,
            30..=37 => style.fg = Some(ANSI_16_COLOR_HEX[(code - 30) as usize].to_string()),
            90..=97 => style.fg = Some(ANSI_16_COLOR_HEX[(8 + code - 90) as usize].to_string()),
            40..=47 => style.bg = Some(ANSI_16_COLOR_HEX[(code - 40) as usize].to_string()),
            100..=107 => style.bg = Some(ANSI_16_COLOR_HEX[(8 + code - 100) as usize].to_string()),
            _ => {}
        }

        index += 1;
    }
}

fn set_channel(style: &mut LogTextStyle, is_foreground: bool, value: Option<String>) {
    if is_foreground {
        style.fg = value;
    } else {
        style.bg = value;
    }
}

fn to_ansi_256_color(index: i64) -> Option<String> {
    if !(0..=255).contains(&index) {
        return None;
    }
    if index < 16 {
        return Some(ANSI_16_COLOR_HEX[index as usize].to_string());
    }
    if index <= 231 {
        let shifted = index - 16;
        let red_level = shifted / 36;
        let green_level = (shifted % 36) / 6;
        let blue_level = shifted % 6;
        let scale = [0, 95, 135, 175, 215, 255];
        return Some(rgb_to_hex(
            scale[red_level as usize],
            scale[green_level as usize],
            scale[blue_level as usize],
        ));
    }
    let gray = 8 + (index - 232) * 10;
    Some(rgb_to_hex(gray, gray, gray))
}

fn rgb_to_hex(red: i64, green: i64, blue: i64) -> String {
    format!("#{red:02x}{green:02x}{blue:02x}")
}

fn is_valid_rgb_channel(value: i64) -> bool {
    (0..=255).contains(&value)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn plain(text: &str) -> ParsedLogSegment {
        ParsedLogSegment {
            text: text.to_string(),
            style: LogTextStyle::default(),
        }
    }

    #[test]
    fn parses_basic_sgr_color_sequences_into_styled_segments() {
        let segments = parse_ansi_log_segments("prefix \u{1b}[31mred\u{1b}[0m suffix");
        assert_eq!(
            segments,
            vec![
                plain("prefix "),
                ParsedLogSegment {
                    text: "red".to_string(),
                    style: LogTextStyle {
                        fg: Some("#aa0000".to_string()),
                        ..Default::default()
                    },
                },
                plain(" suffix"),
            ]
        );
    }

    #[test]
    fn strips_osc_sequences_and_unsafe_control_bytes() {
        let segments = parse_ansi_log_segments("safe\u{1b}]0;title\u{7}\u{7}\u{1}\u{2}text");
        assert_eq!(segments, vec![plain("safetext")]);
    }

    #[test]
    fn ignores_malformed_escape_prefixes_and_keeps_plain_text() {
        let segments = parse_ansi_log_segments("hello \u{1b}[31");
        assert_eq!(segments, vec![plain("hello 31")]);
    }

    #[test]
    fn returns_plain_text_view_for_ansi_colored_lines() {
        assert_eq!(
            sanitize_log_for_display("a \u{1b}[32mok\u{1b}[0m b"),
            "a ok b"
        );
    }

    #[test]
    fn keeps_only_the_last_carriage_return_chunk() {
        assert_eq!(sanitize_log_for_display("first\rsecond"), "second");
    }

    #[test]
    fn decodes_truecolor_and_256_color_sequences() {
        let segments = parse_ansi_log_segments("\u{1b}[38;2;1;2;3mx\u{1b}[38;5;196my");
        assert_eq!(segments[0].style.fg.as_deref(), Some("#010203"));
        assert_eq!(segments[1].style.fg.as_deref(), Some("#ff0000"));
    }

    #[test]
    fn formats_task_tags_to_a_fixed_width() {
        assert_eq!(format_task_tag_for_log("api", 10), "[api]     ");
        assert_eq!(
            format_task_tag_for_log("averylongtaskname", 10),
            "[averyl…] "
        );
    }

    #[test]
    fn formats_elapsed_durations() {
        assert_eq!(format_elapsed_duration(-5), "0ms");
        assert_eq!(format_elapsed_duration(999), "999ms");
        assert_eq!(format_elapsed_duration(1500), "1s");
        assert_eq!(format_elapsed_duration(61_000), "1m 1s");
        assert_eq!(format_elapsed_duration(3_601_000), "1h 0m");
    }

    fn row_texts(rows: &[Vec<ParsedLogSegment>]) -> Vec<String> {
        rows.iter()
            .map(|row| row.iter().map(|segment| segment.text.as_str()).collect())
            .collect()
    }

    #[test]
    fn expands_tabs_to_the_next_tab_stop() {
        // The parser keeps `\t`, matching the TypeScript client; the render
        // layer expands it, because a raw tab written into a cell counts as one
        // column but moves the terminal to its next tab stop, which used to
        // swallow the characters that followed it.
        let rendered = |line: &str| -> String {
            expand_tabs(parse_ansi_log_segments(line))
                .into_iter()
                .map(|segment| segment.text)
                .collect()
        };
        assert_eq!(sanitize_log_for_display("ab\tcd"), "ab\tcd");
        assert_eq!(rendered("ab\tcd"), "ab      cd");
        assert_eq!(rendered("abcdefg\th"), "abcdefg h");
        assert_eq!(rendered("abcdefgh\ti"), "abcdefgh        i");
        assert_eq!(rendered("\tx"), "        x");
    }

    #[test]
    fn never_emits_a_control_character_other_than_a_tab() {
        let line = "a\tb\u{7}c\u{1}d";
        for segment in parse_ansi_log_segments(line) {
            assert!(
                !segment
                    .text
                    .chars()
                    .any(|character| character.is_control() && character != '\t'),
                "control character survived: {:?}",
                segment.text
            );
        }

        // Nothing reaches the screen with a tab still in it.
        for row in wrap_log_line(line, 40) {
            for segment in row {
                assert!(
                    !segment.text.chars().any(char::is_control),
                    "control character survived: {:?}",
                    segment.text
                );
            }
        }
    }

    #[test]
    fn tab_expansion_counts_toward_the_wrapped_width() {
        // The wrap must measure the expanded tab, not the single `\t` char.
        for row in wrap_log_line("ab\tcd efgh", 10) {
            let rendered: String = row.iter().map(|segment| segment.text.as_str()).collect();
            assert!(rendered.width() <= 10, "{rendered:?}");
        }
    }

    #[test]
    fn wraps_on_word_boundaries_and_consumes_the_break_space() {
        let rows = wrap_log_line("alpha bravo charlie", 12);
        assert_eq!(row_texts(&rows), vec!["alpha bravo", "charlie"]);
        assert_eq!(count_log_line_rows("alpha bravo charlie", 12), 2);
    }

    #[test]
    fn hard_breaks_words_longer_than_the_viewport() {
        let rows = wrap_log_line(&"A".repeat(10), 4);
        assert_eq!(row_texts(&rows), vec!["AAAA", "AAAA", "AA"]);
    }

    #[test]
    fn keeps_styling_across_a_wrap_point() {
        let rows = wrap_log_line("\u{1b}[31mredredred green\u{1b}[0m", 9);
        assert_eq!(row_texts(&rows), vec!["redredred", "green"]);
        for row in &rows {
            assert_eq!(row[0].style.fg.as_deref(), Some("#aa0000"));
        }
    }

    #[test]
    fn always_produces_at_least_one_row() {
        assert_eq!(count_log_line_rows("", 20), 1);
        assert_eq!(count_log_line_rows("abc", 0), 3);
    }

    #[test]
    fn wrapped_rows_never_exceed_the_viewport_width() {
        let line = "the quick brown fox jumps over the lazy dog";
        for width in 1..=40 {
            for row in wrap_log_line(line, width) {
                let rendered: String = row.iter().map(|segment| segment.text.as_str()).collect();
                assert!(
                    rendered.width() <= width.max(1),
                    "width {width}: {rendered:?}"
                );
            }
        }
    }

    #[test]
    fn row_counts_agree_with_the_rendered_rows() {
        let line = "\u{1b}[32mstatus\u{1b}[0m compiling a fairly long crate name here";
        for width in 1..=40 {
            assert_eq!(
                count_log_line_rows(line, width),
                wrap_log_line(line, width).len(),
                "width {width}"
            );
        }
    }

    #[test]
    fn resolves_task_log_colors() {
        assert_eq!(
            resolve_task_log_color(Some(" Red ")).as_deref(),
            Some("red")
        );
        assert_eq!(
            resolve_task_log_color(Some("#AABBCC")).as_deref(),
            Some("#aabbcc")
        );
        assert_eq!(resolve_task_log_color(Some("nonsense")), None);
        assert_eq!(resolve_task_log_color(None), None);
    }
}
