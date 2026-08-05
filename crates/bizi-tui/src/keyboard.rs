//! Port of the TypeScript TUI's `lib/keyboard-shortcuts.ts`.

use crossterm::event::{KeyCode, KeyEvent, KeyModifiers};

pub const IS_MACOS: bool = cfg!(target_os = "macos");

fn is_down_key(key: &KeyEvent) -> bool {
    matches!(key.code, KeyCode::Down | KeyCode::Char('j'))
}

fn is_up_key(key: &KeyEvent) -> bool {
    matches!(key.code, KeyCode::Up | KeyCode::Char('k'))
}

/// macOS terminals deliver Option as Alt, everywhere else the shortcut is Ctrl.
fn has_jump_modifier(key: &KeyEvent, is_macos: bool) -> bool {
    if is_macos {
        key.modifiers.contains(KeyModifiers::ALT)
    } else {
        key.modifiers.contains(KeyModifiers::CONTROL)
    }
}

pub fn is_jump_parents_forward_shortcut(key: &KeyEvent, is_macos: bool) -> bool {
    has_jump_modifier(key, is_macos) && is_down_key(key)
}

pub fn is_jump_parents_backward_shortcut(key: &KeyEvent, is_macos: bool) -> bool {
    has_jump_modifier(key, is_macos) && is_up_key(key)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn key(code: KeyCode, modifiers: KeyModifiers) -> KeyEvent {
        KeyEvent::new(code, modifiers)
    }

    #[test]
    fn uses_option_on_macos_and_ctrl_elsewhere() {
        let option_down = key(KeyCode::Down, KeyModifiers::ALT);
        let ctrl_down = key(KeyCode::Char('j'), KeyModifiers::CONTROL);

        assert!(is_jump_parents_forward_shortcut(&option_down, true));
        assert!(!is_jump_parents_forward_shortcut(&option_down, false));
        assert!(is_jump_parents_forward_shortcut(&ctrl_down, false));
        assert!(!is_jump_parents_forward_shortcut(&ctrl_down, true));
    }

    #[test]
    fn distinguishes_forward_from_backward() {
        let option_up = key(KeyCode::Char('k'), KeyModifiers::ALT);
        assert!(is_jump_parents_backward_shortcut(&option_up, true));
        assert!(!is_jump_parents_forward_shortcut(&option_up, true));
    }

    #[test]
    fn plain_arrows_are_not_jump_shortcuts() {
        let plain = key(KeyCode::Down, KeyModifiers::NONE);
        assert!(!is_jump_parents_forward_shortcut(&plain, true));
        assert!(!is_jump_parents_forward_shortcut(&plain, false));
    }
}
