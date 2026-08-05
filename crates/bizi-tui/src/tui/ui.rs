//! Rendering for the interactive TUI. Reproduces the opentui layout: a fixed
//! width task tree on the left, the run details/log view on the right, and a
//! shortcut footer, all inside one continuous box frame.

use ratatui::Frame;
use ratatui::buffer::Buffer;
use ratatui::layout::{Position, Rect};
use ratatui::style::{Color, Modifier, Style};
use unicode_width::UnicodeWidthStr;

use crate::logs::{
    format_elapsed_duration, format_log_timestamp, format_task_tag_for_log, parse_ansi_log_segments,
};
use crate::model::{DisplayTaskStatus, TaskRunStatus, TaskTreeNode};
use crate::status::{parse_color, task_status_display};

use super::{App, Pane, QUIT_ACTIONS};

const GREY: Color = Color::Rgb(0x66, 0x66, 0x66);
const BRIGHT: Color = Color::Rgb(0xe6, 0xe6, 0xe6);
const SEARCH_ERROR: Color = Color::Rgb(0xff, 0x55, 0x55);
const TOAST: Color = Color::Rgb(0x7d, 0xdc, 0x8e);
const SELECTION_BG: Color = Color::Rgb(0x3a, 0x4a, 0x78);
const SELECTION_FG: Color = Color::Rgb(0xff, 0xff, 0xff);
const DIALOG_WIDTH: u16 = 84;
const TASK_PANEL_WIDTH: u16 = 42;
const LOG_TIMESTAMP_WIDTH: usize = 14;
/// Row of the search box's bottom border. Rows 1..=3 hold the box itself.
const SEARCH_BOX_BOTTOM_Y: u16 = 3;

/// A run of text with a single style. Panels are composed from these so they can
/// be clipped and scrolled without fighting a widget tree.
type Runs = Vec<(String, Style)>;

struct FrameLayout {
    area: Rect,
    divider_x: u16,
    panels_bottom_y: u16,
    right_status_y: u16,
    right_separator_y: u16,
    footer_text_y: u16,
    footer_bottom_y: u16,
    task_area: Rect,
    log_area: Rect,
    search_x: u16,
    search_width: u16,
}

pub fn render(frame: &mut Frame, app: &mut App) {
    let area = frame.area();
    let buffer = frame.buffer_mut();
    buffer.reset();

    if area.width < 30 || area.height < 9 {
        draw_str(
            buffer,
            0,
            0,
            "terminal too small",
            Style::default().fg(GREY),
        );
        app.log_area = Rect::default();
        app.task_area = Rect::default();
        return;
    }

    let layout = compute_layout(area);
    app.log_area = layout.log_area;
    app.task_area = layout.task_area;
    app.log_viewport_height = layout.log_area.height as usize;

    draw_chrome(buffer, &layout, app);
    draw_search_box(buffer, &layout, app);
    draw_task_tree(buffer, &layout, app);
    draw_logs(buffer, &layout, app);
    draw_run_status(buffer, &layout, app);
    draw_footer(buffer, &layout, app);

    if app.show_quit_confirmation {
        draw_quit_confirmation(buffer, area, app);
    } else if app.is_task_search_focused {
        let cursor_x = layout.search_x
            + (app.task_search_query.width() as u16).min(layout.search_width.saturating_sub(1));
        frame.set_cursor_position(Position::new(cursor_x, 2));
    }
}

fn compute_layout(area: Rect) -> FrameLayout {
    let divider_x = if area.width >= 62 {
        TASK_PANEL_WIDTH
    } else {
        (area.width / 2).max(14)
    };

    let footer_bottom_y = area.height - 1;
    let footer_text_y = area.height - 2;
    let panels_bottom_y = area.height - 3;
    let right_status_y = area.height - 4;
    let right_separator_y = area.height - 5;

    // The task cards start on the row directly below the search box (rows 1..3),
    // so the search box and the first card share an edge.
    let task_area = Rect {
        x: 2,
        y: SEARCH_BOX_BOTTOM_Y + 1,
        width: divider_x.saturating_sub(3),
        height: panels_bottom_y.saturating_sub(SEARCH_BOX_BOTTOM_Y + 1),
    };
    let log_area = Rect {
        x: divider_x + 2,
        y: 1,
        width: area.width.saturating_sub(divider_x + 4),
        height: right_separator_y.saturating_sub(1),
    };

    FrameLayout {
        area,
        divider_x,
        panels_bottom_y,
        right_status_y,
        right_separator_y,
        footer_text_y,
        footer_bottom_y,
        task_area,
        log_area,
        search_x: 4,
        search_width: divider_x.saturating_sub(7),
    }
}

// ------------------------------------------------------------------- chrome

fn draw_chrome(buffer: &mut Buffer, layout: &FrameLayout, app: &App) {
    let border = Style::default().fg(GREY);
    let logs_border = Style::default().fg(if app.focused_pane == Pane::Logs {
        BRIGHT
    } else {
        GREY
    });
    let width = layout.area.width;
    let right_edge = width - 1;

    // Top edge: ┌────────┬────────┐
    draw_str(buffer, 0, 0, "┌", border);
    for x in 1..right_edge {
        draw_str(
            buffer,
            x,
            0,
            "─",
            if x > layout.divider_x {
                logs_border
            } else {
                border
            },
        );
    }
    draw_str(buffer, layout.divider_x, 0, "┬", logs_border);
    draw_str(buffer, right_edge, 0, "┐", logs_border);

    // Vertical edges.
    for y in 1..layout.panels_bottom_y {
        draw_str(buffer, 0, y, "│", border);
        draw_str(buffer, layout.divider_x, y, "│", logs_border);
        draw_str(buffer, right_edge, y, "│", logs_border);
    }

    // Separator above the run status line, inside the right panel only.
    draw_str(
        buffer,
        layout.divider_x,
        layout.right_separator_y,
        "├",
        logs_border,
    );
    for x in (layout.divider_x + 1)..right_edge {
        draw_str(buffer, x, layout.right_separator_y, "─", logs_border);
    }
    draw_str(
        buffer,
        right_edge,
        layout.right_separator_y,
        "┤",
        logs_border,
    );
    draw_str(
        buffer,
        layout.divider_x,
        layout.right_status_y,
        "│",
        logs_border,
    );
    draw_str(buffer, right_edge, layout.right_status_y, "│", logs_border);

    // Bottom edge of both panels: ├────────┴────────┤
    draw_str(buffer, 0, layout.panels_bottom_y, "├", border);
    for x in 1..right_edge {
        draw_str(buffer, x, layout.panels_bottom_y, "─", border);
    }
    draw_str(
        buffer,
        layout.divider_x,
        layout.panels_bottom_y,
        "┴",
        border,
    );
    draw_str(buffer, right_edge, layout.panels_bottom_y, "┤", border);

    // Footer box: only left/right/bottom borders.
    draw_str(buffer, 0, layout.footer_text_y, "│", border);
    draw_str(buffer, right_edge, layout.footer_text_y, "│", border);
    draw_str(buffer, 0, layout.footer_bottom_y, "└", border);
    for x in 1..right_edge {
        draw_str(buffer, x, layout.footer_bottom_y, "─", border);
    }
    draw_str(buffer, right_edge, layout.footer_bottom_y, "┘", border);
}

// -------------------------------------------------------------- search input

fn draw_search_box(buffer: &mut Buffer, layout: &FrameLayout, app: &App) {
    let style = Style::default().fg(if app.show_task_search_error {
        SEARCH_ERROR
    } else {
        GREY
    });
    let x = 2;
    let width = layout.divider_x.saturating_sub(3);
    if width < 4 {
        return;
    }

    let bottom = SEARCH_BOX_BOTTOM_Y;
    draw_str(buffer, x, 1, "┌", style);
    draw_str(buffer, x, bottom, "└", style);
    for offset in 1..(width - 1) {
        draw_str(buffer, x + offset, 1, "─", style);
        draw_str(buffer, x + offset, bottom, "─", style);
    }
    draw_str(buffer, x + width - 1, 1, "┐", style);
    draw_str(buffer, x + width - 1, bottom, "┘", style);
    draw_str(buffer, x, 2, "│", style);
    draw_str(buffer, x + width - 1, 2, "│", style);

    let text_x = layout.search_x;
    let text_width = layout.search_width;
    if app.task_search_query.is_empty() {
        draw_runs(
            buffer,
            text_x,
            2,
            text_width,
            &[("/ Type task name...".to_string(), Style::default().fg(GREY))],
        );
    } else {
        draw_runs(
            buffer,
            text_x,
            2,
            text_width,
            &[(app.task_search_query.clone(), Style::default())],
        );
    }
}

// ----------------------------------------------------------------- task tree

fn draw_task_tree(buffer: &mut Buffer, layout: &FrameLayout, app: &mut App) {
    let area = layout.task_area;
    if area.width == 0 || area.height == 0 {
        return;
    }

    let selected_key = app.selected_row().map(|row| row.key.clone());
    let mut lines: Vec<Runs> = Vec::new();
    let mut selected_bounds: Option<(usize, usize)> = None;

    for node in &app.task_tree {
        push_task_node(
            node,
            area.width,
            app,
            selected_key.as_deref(),
            &mut lines,
            &mut selected_bounds,
        );
    }

    let viewport = area.height as usize;
    let max_scroll = lines.len().saturating_sub(viewport);

    if let Some((offset, height)) = selected_bounds {
        let start = app.task_scroll;
        let end = start + viewport;
        let is_visible = offset >= start && offset + height <= end;
        if !is_visible {
            app.task_scroll = offset.saturating_sub(1);
        }
    }
    app.task_scroll = app.task_scroll.min(max_scroll);

    for (row, line) in lines
        .iter()
        .skip(app.task_scroll)
        .take(viewport)
        .enumerate()
    {
        draw_runs(buffer, area.x, area.y + row as u16, area.width, line);
    }
}

fn push_task_node(
    node: &TaskTreeNode,
    width: u16,
    app: &App,
    selected_key: Option<&str>,
    lines: &mut Vec<Runs>,
    selected_bounds: &mut Option<(usize, usize)>,
) {
    if width < 6 {
        return;
    }

    let start_offset = lines.len();
    let is_selected = selected_key == Some(node.row.key.as_str());
    let border = Style::default().fg(if is_selected { BRIGHT } else { GREY });
    let status = app
        .display_status_by_task_key
        .get(&node.row.key)
        .copied()
        .flatten();

    lines.push(card_edge(width, border, true));
    lines.push(card_header(&node.row.key, status, width, border));

    if !node.children.is_empty() {
        lines.push(vec![
            ("│".to_string(), border),
            (" ".repeat((width - 2) as usize), Style::default()),
            ("│".to_string(), border),
        ]);

        let child_width = width - 4;
        for child in &node.children {
            let mut child_lines: Vec<Runs> = Vec::new();
            let mut child_bounds: Option<(usize, usize)> = None;
            push_task_node(
                child,
                child_width,
                app,
                selected_key,
                &mut child_lines,
                &mut child_bounds,
            );
            if let Some((child_offset, child_height)) = child_bounds {
                *selected_bounds = Some((lines.len() + child_offset, child_height));
            }
            for child_line in child_lines {
                let mut line: Runs = vec![("│ ".to_string(), border)];
                line.extend(child_line);
                line.push((" │".to_string(), border));
                lines.push(line);
            }
        }
    }

    lines.push(card_edge(width, border, false));

    if is_selected {
        *selected_bounds = Some((start_offset, lines.len() - start_offset));
    }
}

fn card_edge(width: u16, border: Style, is_top: bool) -> Runs {
    let (left, right) = if is_top {
        ("╭", "╮")
    } else {
        ("╰", "╯")
    };
    vec![(
        format!("{left}{}{right}", "─".repeat((width - 2) as usize)),
        border,
    )]
}

fn card_header(
    task_key: &str,
    status: Option<DisplayTaskStatus>,
    width: u16,
    border: Style,
) -> Runs {
    let display = task_status_display(status);
    let field_width = (width - 4) as usize;
    let key_width = field_width.saturating_sub(2);
    let key = truncate_to_width(task_key, key_width);
    let padding = field_width.saturating_sub(key.width() + 1);

    vec![
        ("│ ".to_string(), border),
        (key, Style::default()),
        (" ".repeat(padding), Style::default()),
        (display.icon.to_string(), Style::default().fg(display.color)),
        (" │".to_string(), border),
    ]
}

// ---------------------------------------------------------------- log output

fn draw_logs(buffer: &mut Buffer, layout: &FrameLayout, app: &mut App) {
    let area = layout.log_area;
    if area.width == 0 || area.height == 0 {
        app.rendered_log_rows.clear();
        return;
    }

    let viewport = area.height as usize;
    let max_scroll = app.logs.len().saturating_sub(viewport);
    let scroll = if app.log_follow {
        max_scroll
    } else {
        app.log_scroll.min(max_scroll)
    };
    app.log_scroll = scroll;

    let tag_width = app.log_task_tag_width();

    let mut rendered_rows: Vec<Vec<char>> = Vec::with_capacity(viewport);
    for (row, line) in app.logs.iter().skip(scroll).take(viewport).enumerate() {
        let runs = build_log_runs(app, line, tag_width);
        draw_runs(buffer, area.x, area.y + row as u16, area.width, &runs);
        rendered_rows.push(runs_to_columns(&runs, area.width));
    }
    app.rendered_log_rows = rendered_rows;

    if let Some(selection) = app.selection.as_ref() {
        for row in area.y..(area.y + area.height) {
            let Some((from, to)) = selection.columns_for_row(row) else {
                continue;
            };
            for column in from..to.min(area.x + area.width) {
                if let Some(cell) = buffer.cell_mut(Position::new(column, row)) {
                    cell.set_bg(SELECTION_BG).set_fg(SELECTION_FG);
                }
            }
        }
    }
}

fn build_log_runs(app: &App, line: &crate::model::TaskRunLogLine, tag_width: usize) -> Runs {
    let mut runs: Runs = Vec::new();

    let timestamp = format_log_timestamp(line.timestamp);
    runs.push((
        pad_to_width(&timestamp, LOG_TIMESTAMP_WIDTH),
        Style::default().fg(GREY),
    ));

    let tag_style = match app
        .log_color_for_task(&line.task)
        .as_deref()
        .and_then(parse_color)
    {
        Some(color) => Style::default().fg(color),
        None => Style::default(),
    };
    runs.push((format_task_tag_for_log(&line.task, tag_width), tag_style));

    for segment in parse_ansi_log_segments(&line.line) {
        runs.push((segment.text, log_segment_style(&segment.style)));
    }

    runs
}

fn log_segment_style(style: &crate::logs::LogTextStyle) -> Style {
    let mut resolved = Style::default();
    if let Some(color) = style.fg.as_deref().and_then(parse_color) {
        resolved = resolved.fg(color);
    }
    if let Some(color) = style.bg.as_deref().and_then(parse_color) {
        resolved = resolved.bg(color);
    }
    if style.bold == Some(true) {
        resolved = resolved.add_modifier(Modifier::BOLD);
    }
    if style.dim == Some(true) {
        resolved = resolved.add_modifier(Modifier::DIM);
    }
    if style.italic == Some(true) {
        resolved = resolved.add_modifier(Modifier::ITALIC);
    }
    if style.underline == Some(true) {
        resolved = resolved.add_modifier(Modifier::UNDERLINED);
    }
    resolved
}

// ------------------------------------------------------------- status footer

fn draw_run_status(buffer: &mut Buffer, layout: &FrameLayout, app: &App) {
    let x = layout.divider_x + 2;
    let width = layout.area.width.saturating_sub(layout.divider_x + 4);
    if width == 0 {
        return;
    }

    let mut runs: Runs = Vec::new();
    if app.selected_display_status() != Some(DisplayTaskStatus::Indeterminate) {
        let footer_status = app.selected_footer_status();
        let display = task_status_display(footer_status.map(DisplayTaskStatus::Run));
        runs.push((display.icon.to_string(), Style::default().fg(display.color)));
        runs.push((format!(" {}", run_status_text(app)), Style::default()));
    }

    let left_width: usize = runs.iter().map(|(text, _)| text.width()).sum();
    let cwd = truncate_to_width(&app.cwd, width as usize);
    let gap = (width as usize)
        .saturating_sub(left_width)
        .saturating_sub(cwd.width());
    runs.push((" ".repeat(gap), Style::default()));
    runs.push((cwd, Style::default().fg(GREY)));

    draw_runs(buffer, x, layout.right_status_y, width, &runs);
}

/// Port of `RunDetailsPanel`'s `footerStatusText` memo.
fn run_status_text(app: &App) -> String {
    let now_ms = chrono::Local::now().timestamp_millis();
    let selected_run_updated_at = app.selected_run().map(|run| run.updated_at);
    let first_log_timestamp = app.logs.first().map(|line| line.timestamp);
    let last_log_timestamp = app.logs.last().map(|line| line.timestamp);
    let footer_status = app.selected_footer_status();

    let run_start = first_log_timestamp
        .or(selected_run_updated_at)
        .unwrap_or(now_ms);
    let run_end = match footer_status {
        Some(TaskRunStatus::Running) | Some(TaskRunStatus::Queued) => now_ms,
        _ => last_log_timestamp
            .or(selected_run_updated_at)
            .unwrap_or(now_ms),
    };
    let run_duration_ms = run_end - run_start;

    let waiting_on = app
        .selected_run()
        .and_then(|run| run.waiting_on.as_deref())
        .map(collapse_whitespace)
        .unwrap_or_default();
    if !waiting_on.is_empty() {
        let waiting_duration_ms = now_ms - selected_run_updated_at.unwrap_or(run_start);
        return format!(
            "Waiting on {waiting_on} for {}",
            format_elapsed_duration(waiting_duration_ms)
        );
    }

    match footer_status {
        Some(TaskRunStatus::Running) => {
            format!("Running for {}", format_elapsed_duration(run_duration_ms))
        }
        Some(TaskRunStatus::Cancelled) => {
            format!(
                "Canceled after {}",
                format_elapsed_duration(run_duration_ms)
            )
        }
        Some(TaskRunStatus::Success) => {
            format!("Succeeded in {}", format_elapsed_duration(run_duration_ms))
        }
        Some(TaskRunStatus::Failed) => {
            format!("Failed after {}", format_elapsed_duration(run_duration_ms))
        }
        Some(TaskRunStatus::Queued) => {
            format!("Queued for {}", format_elapsed_duration(run_duration_ms))
        }
        None => collapse_whitespace(
            app.selected_display_status()
                .map(|status| status.label())
                .unwrap_or("Idle"),
        ),
    }
}

fn draw_footer(buffer: &mut Buffer, layout: &FrameLayout, app: &App) {
    let mut actions: Vec<(&str, String)> = vec![("/", "find/run".to_string())];
    if app.selected_row().is_some() {
        actions.push(("r", app.selected_run_action().label().to_string()));
    }
    if app.can_cancel_selected() {
        actions.push(("c", "cancel".to_string()));
    }
    if app.can_toggle_log_mode() {
        actions.push(("m", format!("logs: {}", app.log_mode.label())));
    }
    actions.push(("ctrl+c", "copy".to_string()));
    actions.push(("q", "quit".to_string()));

    let mut runs: Runs = Vec::new();
    for (index, (key, label)) in actions.iter().enumerate() {
        if index > 0 {
            runs.push((" | ".to_string(), Style::default().fg(GREY)));
        }
        runs.push((format!("{key} "), Style::default()));
        runs.push((label.clone(), Style::default().fg(GREY)));
    }

    if let Some(message) = &app.copy_toast_message {
        runs.push((" | ".to_string(), Style::default().fg(GREY)));
        runs.push((message.clone(), Style::default().fg(TOAST)));
    }
    if let Some(message) = &app.error_message {
        runs.push((format!(" | error: {message}"), Style::default()));
    }

    let width = layout.area.width.saturating_sub(3);
    draw_runs(buffer, 2, layout.footer_text_y, width, &runs);
}

// ----------------------------------------------------------- quit dialog

fn draw_quit_confirmation(buffer: &mut Buffer, area: Rect, app: &App) {
    // The overlay blacks out the whole screen before drawing the dialog.
    for y in area.y..(area.y + area.height) {
        for x in area.x..(area.x + area.width) {
            if let Some(cell) = buffer.cell_mut(Position::new(x, y)) {
                cell.set_symbol(" ")
                    .set_fg(Color::Reset)
                    .set_bg(Color::Rgb(0, 0, 0));
            }
        }
    }

    let running_tasks = app.running_task_rows();
    let width = DIALOG_WIDTH.min(area.width.saturating_sub(2));
    let height = 22u16.min(area.height);
    let x = area.x + (area.width.saturating_sub(width)) / 2;
    let y = area.y + (area.height.saturating_sub(height)) / 2;

    let border = Style::default().fg(GREY).bg(Color::Rgb(0, 0, 0));
    let text_style = Style::default().bg(Color::Rgb(0, 0, 0));
    let muted = Style::default().fg(GREY).bg(Color::Rgb(0, 0, 0));

    draw_box(buffer, x, y, width, height, border);

    let inner_x = x + 2;
    let inner_width = width.saturating_sub(4);
    draw_runs(
        buffer,
        inner_x,
        y + 1,
        inner_width,
        &[("Exit confirmation".to_string(), text_style)],
    );
    draw_runs(
        buffer,
        inner_x,
        y + 3,
        inner_width,
        &[(
            "Would you like to cancel the following tasks before exiting?".to_string(),
            muted,
        )],
    );

    // Bordered list of the tasks that are still running.
    let list_y = y + 5;
    let list_height = 12u16.min(height.saturating_sub(9));
    draw_box(buffer, inner_x, list_y, inner_width, list_height, border);

    let card_width = inner_width.saturating_sub(4);
    let visible_cards = (list_height.saturating_sub(2) / 3) as usize;
    for (index, task) in running_tasks.iter().take(visible_cards).enumerate() {
        let card_y = list_y + 1 + (index as u16 * 3);
        let card_x = inner_x + 2;
        draw_runs(
            buffer,
            card_x,
            card_y,
            card_width,
            &card_edge(card_width, border, true),
        );
        draw_runs(
            buffer,
            card_x,
            card_y + 1,
            card_width,
            &card_header(
                &task.key,
                Some(DisplayTaskStatus::Run(task.status)),
                card_width,
                border,
            )
            .into_iter()
            .map(|(text, style)| (text, style.bg(Color::Rgb(0, 0, 0))))
            .collect::<Runs>(),
        );
        draw_runs(
            buffer,
            card_x,
            card_y + 2,
            card_width,
            &card_edge(card_width, border, false),
        );
    }

    let buttons_y = list_y + list_height + 1;
    if app.is_cancelling_before_exit {
        draw_runs(
            buffer,
            inner_x,
            buttons_y + 1,
            inner_width,
            &[("(cancelling tasks...)".to_string(), text_style)],
        );
        return;
    }

    let mut button_x = inner_x;
    for (index, (label, _)) in QUIT_ACTIONS.iter().enumerate() {
        let is_selected = index == app.quit_action_index;
        let style = if is_selected {
            Style::default()
                .fg(Color::Rgb(0, 0, 0))
                .bg(Color::Rgb(0xff, 0xff, 0xff))
        } else {
            Style::default()
                .fg(Color::Rgb(0xff, 0xff, 0xff))
                .bg(Color::Rgb(0, 0, 0))
        };
        let padded = format!("  {label}  ");
        let button_width = padded.width() as u16;
        for row in 0..3u16 {
            let content = if row == 1 {
                padded.clone()
            } else {
                " ".repeat(padded.width())
            };
            draw_runs(
                buffer,
                button_x,
                buttons_y + row,
                button_width,
                &[(content, style)],
            );
        }
        button_x += button_width + 1;
    }
}

fn draw_box(buffer: &mut Buffer, x: u16, y: u16, width: u16, height: u16, style: Style) {
    if width < 2 || height < 2 {
        return;
    }
    let horizontal = "─".repeat((width - 2) as usize);
    draw_str(buffer, x, y, &format!("┌{horizontal}┐"), style);
    draw_str(buffer, x, y + height - 1, &format!("└{horizontal}┘"), style);
    for row in 1..(height - 1) {
        draw_str(buffer, x, y + row, "│", style);
        draw_str(buffer, x + width - 1, y + row, "│", style);
    }
}

// ------------------------------------------------------------------- helpers

fn draw_str(buffer: &mut Buffer, x: u16, y: u16, text: &str, style: Style) {
    let area = buffer.area;
    if y >= area.y + area.height {
        return;
    }
    let mut cursor = x;
    for grapheme in text.chars() {
        if cursor >= area.x + area.width {
            break;
        }
        if let Some(cell) = buffer.cell_mut(Position::new(cursor, y)) {
            cell.set_symbol(&grapheme.to_string());
            cell.set_style(style);
        }
        cursor += grapheme_width(grapheme);
    }
}

fn draw_runs(buffer: &mut Buffer, x: u16, y: u16, max_width: u16, runs: &[(String, Style)]) {
    let mut cursor = x;
    let limit = x.saturating_add(max_width);
    for (text, style) in runs {
        if cursor >= limit {
            break;
        }
        for character in text.chars() {
            if cursor >= limit {
                break;
            }
            if let Some(cell) = buffer.cell_mut(Position::new(cursor, y)) {
                cell.set_symbol(&character.to_string());
                cell.set_style(*style);
            }
            cursor += grapheme_width(character);
        }
    }
}

/// The characters `draw_runs` would place, one entry per terminal column.
/// Wide characters occupy their first column and pad the rest with spaces, which
/// is what the renderer leaves behind in the buffer.
fn runs_to_columns(runs: &[(String, Style)], max_width: u16) -> Vec<char> {
    let limit = max_width as usize;
    let mut columns: Vec<char> = Vec::with_capacity(limit);

    for (text, _) in runs {
        for character in text.chars() {
            if columns.len() >= limit {
                return columns;
            }
            columns.push(character);
            for _ in 1..grapheme_width(character) {
                if columns.len() >= limit {
                    return columns;
                }
                columns.push(' ');
            }
        }
    }

    columns
}

fn grapheme_width(character: char) -> u16 {
    unicode_width::UnicodeWidthChar::width(character)
        .unwrap_or(0)
        .max(1) as u16
}

fn truncate_to_width(text: &str, max_width: usize) -> String {
    if text.width() <= max_width {
        return text.to_string();
    }
    if max_width == 0 {
        return String::new();
    }

    let mut out = String::new();
    let mut used = 0usize;
    for character in text.chars() {
        let char_width = unicode_width::UnicodeWidthChar::width(character)
            .unwrap_or(0)
            .max(1);
        if used + char_width > max_width.saturating_sub(1) {
            break;
        }
        out.push(character);
        used += char_width;
    }
    out.push('…');
    out
}

fn pad_to_width(text: &str, width: usize) -> String {
    let mut out = text.to_string();
    while out.width() < width {
        out.push(' ');
    }
    out
}

fn collapse_whitespace(value: &str) -> String {
    value.split_whitespace().collect::<Vec<_>>().join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn truncates_with_an_ellipsis() {
        assert_eq!(truncate_to_width("hello", 10), "hello");
        assert_eq!(truncate_to_width("hello world", 5), "hell…");
        assert_eq!(truncate_to_width("hello", 0), "");
    }

    #[test]
    fn pads_to_a_fixed_width() {
        assert_eq!(pad_to_width("12:00:00.000", 14), "12:00:00.000  ");
        assert_eq!(pad_to_width("longer-than-width", 3), "longer-than-width");
    }

    #[test]
    fn collapses_whitespace_like_the_typescript_ui() {
        assert_eq!(collapse_whitespace("  a \n b  "), "a b");
        assert_eq!(collapse_whitespace(""), "");
    }

    #[test]
    fn renders_a_leaf_card_at_the_requested_width() {
        let border = Style::default();
        let top = card_edge(20, border, true);
        let rendered: String = top.iter().map(|(text, _)| text.as_str()).collect();
        assert_eq!(rendered.width(), 20);
        assert!(rendered.starts_with('╭') && rendered.ends_with('╮'));

        let header = card_header("dev:api", None, 20, border);
        let rendered: String = header.iter().map(|(text, _)| text.as_str()).collect();
        assert_eq!(rendered.width(), 20);
        assert!(rendered.contains("dev:api"));
    }
}
