//! Minimal reimplementation of the `@clack/prompts` look and feel used by the
//! TypeScript CLI (`intro`, `confirm`, `multiselect`, `log.*`, `cancel`,
//! `outro`).

use std::io::{IsTerminal, Write, stdout};

use crossterm::event::{self, Event, KeyCode, KeyEventKind, KeyModifiers};
use crossterm::terminal::{disable_raw_mode, enable_raw_mode};

const BAR_START: &str = "┌";
const BAR: &str = "│";
const BAR_END: &str = "└";
const STEP_ACTIVE: &str = "◆";
const STEP_SUBMIT: &str = "◇";
const STEP_ERROR: &str = "■";
const RADIO_ACTIVE: &str = "●";
const RADIO_INACTIVE: &str = "○";
const CHECKBOX_ACTIVE: &str = "◼";
const CHECKBOX_INACTIVE: &str = "◻";

pub fn is_interactive() -> bool {
    stdout().is_terminal()
}

fn color_enabled() -> bool {
    std::env::var_os("NO_COLOR").is_none() && stdout().is_terminal()
}

pub fn paint(code: &str, text: &str) -> String {
    if color_enabled() {
        format!("\u{1b}[{code}m{text}\u{1b}[0m")
    } else {
        text.to_string()
    }
}

pub fn dim(text: &str) -> String {
    paint("2", text)
}
pub fn cyan(text: &str) -> String {
    paint("36", text)
}
pub fn green(text: &str) -> String {
    paint("32", text)
}
pub fn red(text: &str) -> String {
    paint("31", text)
}
pub fn yellow(text: &str) -> String {
    paint("33", text)
}
pub fn blue(text: &str) -> String {
    paint("34", text)
}

pub fn intro(message: &str) {
    println!("{}  {message}", dim(BAR_START));
    println!("{}", dim(BAR));
}

pub fn outro(message: &str) {
    println!("{}", dim(BAR));
    println!("{}  {message}", dim(BAR_END));
}

pub fn log_success(message: &str) {
    println!("{}  {message}", green(STEP_SUBMIT));
}

pub fn log_error(message: &str) {
    println!("{}  {message}", red(STEP_ERROR));
}

pub fn cancel(message: &str) {
    println!("{}  {}", red(BAR_END), red(message));
}

/// A prompt answer. `Cancelled` matches clack's `isCancel` case (Ctrl+C/Esc).
pub enum PromptResult<T> {
    Value(T),
    Cancelled,
}

struct RawModeGuard;

impl RawModeGuard {
    fn enter() -> std::io::Result<Self> {
        enable_raw_mode()?;
        Ok(Self)
    }
}

impl Drop for RawModeGuard {
    fn drop(&mut self) {
        let _ = disable_raw_mode();
    }
}

fn clear_lines(count: usize) {
    if count == 0 {
        return;
    }
    let mut out = stdout();
    let _ = write!(out, "\u{1b}[{count}A\u{1b}[0J");
    let _ = out.flush();
}

fn print_frame(lines: &[String]) {
    let mut out = stdout();
    for line in lines {
        let _ = write!(out, "{line}\r\n");
    }
    let _ = out.flush();
}

/// Yes/no prompt. Left/right (or y/n) switch, enter submits.
pub fn confirm(message: &str, initial_value: bool) -> std::io::Result<PromptResult<bool>> {
    if !is_interactive() {
        return Ok(PromptResult::Value(initial_value));
    }

    let _guard = RawModeGuard::enter()?;
    let mut value = initial_value;
    let mut rendered = 0usize;

    loop {
        let yes = if value {
            green(&format!("{RADIO_ACTIVE} Yes"))
        } else {
            dim(&format!("{RADIO_INACTIVE} Yes"))
        };
        let no = if value {
            dim(&format!("{RADIO_INACTIVE} No"))
        } else {
            green(&format!("{RADIO_ACTIVE} No"))
        };

        let frame = vec![
            format!("{}  {message}", cyan(STEP_ACTIVE)),
            format!("{}  {yes} {} {no}", cyan(BAR), dim("/")),
            cyan(BAR_END).to_string(),
        ];
        clear_lines(rendered);
        print_frame(&frame);
        rendered = frame.len();

        let Event::Key(key) = event::read()? else {
            continue;
        };
        if key.kind != KeyEventKind::Press {
            continue;
        }

        match key.code {
            KeyCode::Char('c') | KeyCode::Char('d')
                if key.modifiers.contains(KeyModifiers::CONTROL) =>
            {
                clear_lines(rendered);
                print_frame(&[
                    format!("{}  {message}", red(STEP_ERROR)),
                    format!("{}  {}", dim(BAR), dim("cancelled")),
                ]);
                return Ok(PromptResult::Cancelled);
            }
            KeyCode::Esc => {
                clear_lines(rendered);
                print_frame(&[
                    format!("{}  {message}", red(STEP_ERROR)),
                    format!("{}  {}", dim(BAR), dim("cancelled")),
                ]);
                return Ok(PromptResult::Cancelled);
            }
            KeyCode::Left
            | KeyCode::Right
            | KeyCode::Tab
            | KeyCode::Char('h')
            | KeyCode::Char('l') => value = !value,
            KeyCode::Char('y') | KeyCode::Char('Y') => value = true,
            KeyCode::Char('n') | KeyCode::Char('N') => value = false,
            KeyCode::Enter => {
                clear_lines(rendered);
                print_frame(&[
                    format!("{}  {message}", green(STEP_SUBMIT)),
                    format!("{}  {}", dim(BAR), dim(if value { "Yes" } else { "No" })),
                ]);
                return Ok(PromptResult::Value(value));
            }
            _ => {}
        }
    }
}

pub struct MultiSelectOption {
    pub value: String,
    pub label: String,
    pub hint: Option<String>,
}

/// Multi select prompt. Space toggles, `a` toggles everything, enter submits.
pub fn multiselect(
    message: &str,
    options: &[MultiSelectOption],
    initial_values: &[String],
) -> std::io::Result<PromptResult<Vec<String>>> {
    if options.is_empty() || !is_interactive() {
        return Ok(PromptResult::Value(initial_values.to_vec()));
    }

    let _guard = RawModeGuard::enter()?;
    let mut selected: Vec<bool> = options
        .iter()
        .map(|option| initial_values.contains(&option.value))
        .collect();
    let mut cursor = 0usize;
    let mut rendered = 0usize;

    loop {
        let mut frame = vec![format!("{}  {message}", cyan(STEP_ACTIVE))];
        for (index, option) in options.iter().enumerate() {
            let checkbox = if selected[index] {
                green(CHECKBOX_ACTIVE)
            } else {
                dim(CHECKBOX_INACTIVE)
            };
            let label = if index == cursor {
                option.label.clone()
            } else {
                dim(&option.label)
            };
            let hint = match (&option.hint, index == cursor) {
                (Some(hint), true) => format!(" {}", dim(&format!("({hint})"))),
                _ => String::new(),
            };
            frame.push(format!("{}  {checkbox} {label}{hint}", cyan(BAR)));
        }
        frame.push(cyan(BAR_END).to_string());

        clear_lines(rendered);
        print_frame(&frame);
        rendered = frame.len();

        let Event::Key(key) = event::read()? else {
            continue;
        };
        if key.kind != KeyEventKind::Press {
            continue;
        }

        match key.code {
            KeyCode::Char('c') | KeyCode::Char('d')
                if key.modifiers.contains(KeyModifiers::CONTROL) =>
            {
                clear_lines(rendered);
                print_frame(&[
                    format!("{}  {message}", red(STEP_ERROR)),
                    format!("{}  {}", dim(BAR), dim("cancelled")),
                ]);
                return Ok(PromptResult::Cancelled);
            }
            KeyCode::Esc => {
                clear_lines(rendered);
                print_frame(&[
                    format!("{}  {message}", red(STEP_ERROR)),
                    format!("{}  {}", dim(BAR), dim("cancelled")),
                ]);
                return Ok(PromptResult::Cancelled);
            }
            KeyCode::Up | KeyCode::Char('k') => {
                cursor = if cursor == 0 {
                    options.len() - 1
                } else {
                    cursor - 1
                };
            }
            KeyCode::Down | KeyCode::Char('j') => {
                cursor = (cursor + 1) % options.len();
            }
            KeyCode::Char(' ') => selected[cursor] = !selected[cursor],
            KeyCode::Char('a') => {
                let all_selected = selected.iter().all(|value| *value);
                selected.iter_mut().for_each(|value| *value = !all_selected);
            }
            KeyCode::Enter => {
                let values: Vec<String> = options
                    .iter()
                    .zip(selected.iter())
                    .filter(|(_, is_selected)| **is_selected)
                    .map(|(option, _)| option.value.clone())
                    .collect();
                let summary = if values.is_empty() {
                    "none".to_string()
                } else {
                    values.join(", ")
                };
                clear_lines(rendered);
                print_frame(&[
                    format!("{}  {message}", green(STEP_SUBMIT)),
                    format!("{}  {}", dim(BAR), dim(&summary)),
                ]);
                return Ok(PromptResult::Value(values));
            }
            _ => {}
        }
    }
}
