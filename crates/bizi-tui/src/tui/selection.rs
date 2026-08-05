//! Mouse driven text selection over the rendered log view plus OSC52 copy.
//!
//! The TypeScript TUI leaned on opentui's renderer selection; here we track the
//! drag ourselves and copy from the characters the renderer laid out for each
//! log row, which keeps every visual row on one line in the copied text.

use std::io::{Write, stdout};

use base64::Engine;
use base64::engine::general_purpose::STANDARD as BASE64;
use ratatui::layout::Rect;

#[derive(Debug, Clone)]
pub struct Selection {
    area: Rect,
    anchor: (u16, u16),
    cursor: (u16, u16),
}

impl Selection {
    pub fn new(area: Rect, position: (u16, u16)) -> Self {
        Self {
            area,
            anchor: clamp_to_area(area, position),
            cursor: clamp_to_area(area, position),
        }
    }

    pub fn extend_to(&mut self, position: (u16, u16)) {
        self.cursor = clamp_to_area(self.area, position);
    }

    /// Ordered (start, end) points, top-left first.
    fn ordered(&self) -> ((u16, u16), (u16, u16)) {
        let (anchor_column, anchor_row) = self.anchor;
        let (cursor_column, cursor_row) = self.cursor;
        if (anchor_row, anchor_column) <= (cursor_row, cursor_column) {
            (self.anchor, self.cursor)
        } else {
            (self.cursor, self.anchor)
        }
    }

    pub fn is_empty(&self) -> bool {
        self.anchor == self.cursor
    }

    /// Column range selected on `row`, or `None` when the row is outside the
    /// selection.
    pub fn columns_for_row(&self, row: u16) -> Option<(u16, u16)> {
        if self.is_empty() {
            return None;
        }
        let ((start_column, start_row), (end_column, end_row)) = self.ordered();
        if row < start_row || row > end_row {
            return None;
        }

        let left = self.area.x;
        let right = self.area.x + self.area.width;
        let from = if row == start_row { start_column } else { left };
        let to = if row == end_row { end_column } else { right };
        if to <= from { None } else { Some((from, to)) }
    }
}

fn clamp_to_area(area: Rect, (column, row): (u16, u16)) -> (u16, u16) {
    let max_column = area.x + area.width.saturating_sub(1);
    let max_row = area.y + area.height.saturating_sub(1);
    (
        column.clamp(area.x, max_column.max(area.x)),
        row.clamp(area.y, max_row.max(area.y)),
    )
}

pub fn contains(area: Rect, (column, row): (u16, u16)) -> bool {
    area.width > 0
        && area.height > 0
        && column >= area.x
        && column < area.x + area.width
        && row >= area.y
        && row < area.y + area.height
}

/// Copies the selected columns out of the rows the renderer laid out. `rows[i]`
/// holds one `char` per terminal column of the row at `area.y + i`.
pub fn selected_text(rows: &[Vec<char>], area: Rect, selection: &Selection) -> String {
    let mut lines: Vec<String> = Vec::new();

    for (index, row_columns) in rows.iter().enumerate() {
        let row = area.y + index as u16;
        let Some((from, to)) = selection.columns_for_row(row) else {
            continue;
        };

        let start = from.saturating_sub(area.x) as usize;
        let end = (to.saturating_sub(area.x) as usize).min(row_columns.len());
        let line: String = if start >= end {
            String::new()
        } else {
            row_columns[start..end].iter().collect()
        };

        lines.push(line.trim_end().to_string());
    }

    while lines.last().map(|line| line.is_empty()).unwrap_or(false) {
        lines.pop();
    }

    lines.join("\n")
}

/// Writes an OSC52 clipboard sequence. Terminals that do not implement OSC52
/// silently ignore it, so this reports success whenever the write itself works.
pub fn copy_to_clipboard_osc52(text: &str) -> bool {
    let encoded = BASE64.encode(text.as_bytes());
    let mut out = stdout();
    let written = write!(out, "\u{1b}]52;c;{encoded}\u{7}").is_ok();
    written && out.flush().is_ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rows_of(lines: &[&str]) -> Vec<Vec<char>> {
        lines.iter().map(|line| line.chars().collect()).collect()
    }

    #[test]
    fn selects_a_single_row_range() {
        let rows = rows_of(&["hello world"]);
        let area = Rect::new(0, 0, 11, 1);
        let mut selection = Selection::new(area, (0, 0));
        selection.extend_to((5, 0));
        assert_eq!(selected_text(&rows, area, &selection), "hello");
    }

    #[test]
    fn selects_across_rows_keeping_one_line_per_row() {
        let rows = rows_of(&["first line", "second   ", "third    "]);
        let area = Rect::new(0, 0, 10, 3);
        let mut selection = Selection::new(area, (6, 0));
        selection.extend_to((5, 2));
        assert_eq!(
            selected_text(&rows, area, &selection),
            "line\nsecond\nthird"
        );
    }

    #[test]
    fn selects_from_an_offset_area() {
        let rows = rows_of(&["alpha", "bravo"]);
        let area = Rect::new(10, 4, 5, 2);
        let mut selection = Selection::new(area, (11, 4));
        selection.extend_to((13, 5));
        assert_eq!(selected_text(&rows, area, &selection), "lpha\nbra");
    }

    #[test]
    fn reversed_drags_select_the_same_text() {
        let rows = rows_of(&["abc", "def"]);
        let area = Rect::new(0, 0, 3, 2);
        let mut forward = Selection::new(area, (0, 0));
        forward.extend_to((2, 1));
        let mut backward = Selection::new(area, (2, 1));
        backward.extend_to((0, 0));
        assert_eq!(
            selected_text(&rows, area, &forward),
            selected_text(&rows, area, &backward)
        );
    }

    #[test]
    fn an_unmoved_click_selects_nothing() {
        let rows = rows_of(&["abc"]);
        let area = Rect::new(0, 0, 3, 1);
        let selection = Selection::new(area, (1, 0));
        assert_eq!(selected_text(&rows, area, &selection), "");
    }

    #[test]
    fn clamps_positions_to_the_area() {
        let area = Rect::new(2, 1, 4, 2);
        let mut selection = Selection::new(area, (0, 0));
        selection.extend_to((99, 99));
        assert_eq!(selection.anchor, (2, 1));
        assert_eq!(selection.cursor, (5, 2));
    }
}
