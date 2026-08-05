use ratatui::style::Color;

use crate::model::{DisplayTaskStatus, TaskRunStatus};

pub struct TaskStatusDisplay {
    pub color: Color,
    pub icon: &'static str,
}

/// Port of `lib/status.ts`.
pub fn task_status_display(status: Option<DisplayTaskStatus>) -> TaskStatusDisplay {
    match status {
        None => TaskStatusDisplay {
            color: hex_color(0x77, 0x77, 0x77),
            icon: "○",
        },
        Some(DisplayTaskStatus::Indeterminate) => TaskStatusDisplay {
            color: hex_color(0xf4, 0xc5, 0x42),
            icon: "◐",
        },
        Some(DisplayTaskStatus::Run(TaskRunStatus::Queued)) => TaskStatusDisplay {
            color: hex_color(0xf4, 0xc5, 0x42),
            icon: "○",
        },
        Some(DisplayTaskStatus::Run(TaskRunStatus::Running)) => TaskStatusDisplay {
            color: hex_color(0x31, 0xd1, 0x58),
            icon: "▶",
        },
        Some(DisplayTaskStatus::Run(TaskRunStatus::Success)) => TaskStatusDisplay {
            color: hex_color(0x4d, 0xa3, 0xff),
            icon: "✓",
        },
        Some(DisplayTaskStatus::Run(TaskRunStatus::Failed)) => TaskStatusDisplay {
            color: hex_color(0xff, 0x3b, 0x30),
            icon: "✖",
        },
        Some(DisplayTaskStatus::Run(TaskRunStatus::Cancelled)) => TaskStatusDisplay {
            color: hex_color(0x77, 0x77, 0x77),
            icon: "■",
        },
    }
}

pub const fn hex_color(red: u8, green: u8, blue: u8) -> Color {
    Color::Rgb(red, green, blue)
}

/// Parses the colors that can appear in a `task.config.json` (`"red"`,
/// `"#ff00aa"`, `"#f0a"`) into a ratatui color.
pub fn parse_color(value: &str) -> Option<Color> {
    let value = value.trim();
    if let Some(hex) = value.strip_prefix('#') {
        let expanded = match hex.len() {
            3 => hex
                .chars()
                .flat_map(|character| [character, character])
                .collect::<String>(),
            6 => hex.to_string(),
            _ => return None,
        };
        let red = u8::from_str_radix(&expanded[0..2], 16).ok()?;
        let green = u8::from_str_radix(&expanded[2..4], 16).ok()?;
        let blue = u8::from_str_radix(&expanded[4..6], 16).ok()?;
        return Some(Color::Rgb(red, green, blue));
    }

    match value.to_lowercase().as_str() {
        "black" => Some(Color::Black),
        "red" => Some(Color::Red),
        "green" => Some(Color::Green),
        "yellow" => Some(Color::Yellow),
        "blue" => Some(Color::Blue),
        "magenta" => Some(Color::Magenta),
        "cyan" => Some(Color::Cyan),
        "white" => Some(Color::White),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_hex_and_named_colors() {
        assert_eq!(parse_color("#ff0000"), Some(Color::Rgb(255, 0, 0)));
        assert_eq!(parse_color("#f00"), Some(Color::Rgb(255, 0, 0)));
        assert_eq!(parse_color("Green"), Some(Color::Green));
        assert_eq!(parse_color("chartreuse"), None);
    }

    #[test]
    fn maps_statuses_to_icons() {
        assert_eq!(task_status_display(None).icon, "○");
        assert_eq!(
            task_status_display(Some(DisplayTaskStatus::Run(TaskRunStatus::Running))).icon,
            "▶"
        );
        assert_eq!(
            task_status_display(Some(DisplayTaskStatus::Indeterminate)).icon,
            "◐"
        );
    }
}
