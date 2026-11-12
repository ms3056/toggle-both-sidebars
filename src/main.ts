import { App, Notice, Plugin, PluginSettingTab, Setting } from "obsidian";
import type { Hotkey, Modifier, SettingDefinitionItem } from "obsidian";

// ---------------------------------------------------------------------------
// Internal Obsidian APIs used by this plugin. They are not in the public
// obsidian.d.ts, so they are typed locally and always accessed defensively.
// ---------------------------------------------------------------------------
interface InternalCommands {
  commands: Record<string, unknown>;
  executeCommandById(id: string): boolean;
}

interface InternalHotkeyManager {
  getHotkeys(commandId: string): Hotkey[] | undefined;
  getDefaultHotkeys(commandId: string): Hotkey[] | undefined;
  setHotkeys(commandId: string, hotkeys: Hotkey[]): void;
}

type AppWithInternals = App & {
  commands?: InternalCommands;
  hotkeyManager?: InternalHotkeyManager;
};

/** WorkspaceSidedock exposes toggle() at runtime; typed loosely here. */
interface Toggleable {
  toggle?: () => void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// Obsidian's own sidebar toggle commands. Calling these instead of poking
// the layout manually means behavior (animations, autohide/CSS hooks,
// mobile drawers) matches the built-in hotkeys exactly.
const CMD_LEFT = "app:toggle-left-sidebar";
const CMD_RIGHT = "app:toggle-right-sidebar";

const COMMAND_ID = "toggle-both-sidebars";
// Default hotkey: Cmd+Option+T (Ctrl+Alt+T on Windows/Linux, via 'Mod').
const DEFAULT_HOTKEY: Hotkey = { modifiers: ["Mod", "Alt"], key: "T" };

const MODIFIER_KEYS = ["Control", "Alt", "Shift", "Meta"];

// Normalize a few event.key values the same way Obsidian's own recorder does.
const KEY_NAMES: Record<string, string> = {
  " ": "Space",
  ArrowDown: "Down",
  ArrowLeft: "Left",
  ArrowRight: "Right",
  ArrowUp: "Up",
  "+": "Plus",
};

const MOD_LABELS: Record<string, string> = {
  Mod: "Cmd",
  Ctrl: "Ctrl",
  Alt: "Option",
  Shift: "Shift",
  Meta: "Cmd",
};

interface ToggleBothSidebarsSettings {
  doubleClickEnabled: boolean;
}

const DEFAULT_SETTINGS: ToggleBothSidebarsSettings = {
  doubleClickEnabled: true,
};

function cloneDefaultHotkey(): Hotkey {
  return { modifiers: [...DEFAULT_HOTKEY.modifiers], key: DEFAULT_HOTKEY.key };
}

function hotkeyLabel(hotkey: Hotkey | null | undefined): string {
  if (!hotkey) return "None";
  const mods = (hotkey.modifiers || []).map((m) => MOD_LABELS[m] || m);
  return [...mods, hotkey.key].join("+");
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

export default class ToggleBothSidebars extends Plugin {
  settings: ToggleBothSidebarsSettings = { ...DEFAULT_SETTINGS };

  private get internalApp(): AppWithInternals {
    return this.app as AppWithInternals;
  }

  async onload(): Promise<void> {
    await this.loadSettings();

    // Command with a default hotkey (Cmd+Option+T) and native hotkey
    // support: it appears in the Command palette and in
    // Settings -> Hotkeys, where the user can also rebind it.
    this.addCommand({
      id: COMMAND_ID,
      name: "Toggle both sidebars",
      hotkeys: [cloneDefaultHotkey()],
      callback: () => this.toggleBoth(),
    });

    // Double-click on the note text area (left mouse button).
    // Uses the browser's native dblclick event, so OS double-click
    // timing applies and single clicks are untouched.
    this.registerDomEvent(document, "dblclick", (evt: MouseEvent) => {
      if (!this.settings.doubleClickEnabled) return;
      if (evt.button !== 0) return; // left mouse button only
      const el = evt.target as Element | null;
      if (!el || typeof el.closest !== "function") return;
      // Only the markdown content area: edit mode (.markdown-source-view)
      // and reading mode (.markdown-preview-view). File lists, tab bars,
      // ribbon, and settings panels stay unaffected.
      if (el.closest(".markdown-source-view, .markdown-preview-view")) {
        this.toggleBoth();
      }
    });

    this.addSettingTab(new ToggleBothSidebarsSettingTab(this.app, this));
  }

  onunload(): void {}

  toggleBoth(): void {
    // Each sidebar flips its own state: open -> closed, closed -> open.
    this.runBuiltin(CMD_LEFT, this.app.workspace.leftSplit as unknown as Toggleable);
    this.runBuiltin(CMD_RIGHT, this.app.workspace.rightSplit as unknown as Toggleable);
  }

  // Prefer Obsidian's built-in command; fall back to the sidedock's own
  // toggle() method only if the command is ever missing.
  runBuiltin(id: string, split: Toggleable | null | undefined): void {
    const commands = this.internalApp.commands;
    if (commands && commands.commands[id]) {
      commands.executeCommandById(id);
    } else if (split && typeof split.toggle === "function") {
      split.toggle();
    }
  }

  // The currently active hotkey: a custom one if the user recorded it,
  // otherwise Obsidian's default for the command, otherwise our fallback.
  currentHotkey(): Hotkey {
    const mgr = this.internalApp.hotkeyManager;
    if (mgr) {
      const custom = mgr.getHotkeys(COMMAND_ID);
      if (custom && custom.length) return custom[0];
      const def = mgr.getDefaultHotkeys(COMMAND_ID);
      if (def && def.length) return def[0];
    }
    return DEFAULT_HOTKEY;
  }

  // Persist a recorded hotkey into Obsidian's hotkey store so it works
  // app-wide and shows in Settings -> Hotkeys.
  saveHotkey(hotkey: Hotkey): boolean {
    const mgr = this.internalApp.hotkeyManager;
    if (!mgr) {
      new Notice("This Obsidian version does not support changing hotkeys from a plugin.");
      return false;
    }
    try {
      mgr.setHotkeys(COMMAND_ID, [hotkey]);
      return true;
    } catch (err) {
      console.error("ToggleBothSidebars: could not save hotkey", err);
      new Notice("Could not save the hotkey. Check the console for details.");
      return false;
    }
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }
}

// ---------------------------------------------------------------------------
// Settings tab
// ---------------------------------------------------------------------------

class ToggleBothSidebarsSettingTab extends PluginSettingTab {
  plugin: ToggleBothSidebars;

  constructor(app: App, plugin: ToggleBothSidebars) {
    super(app, plugin);
    this.plugin = plugin;
  }

  // Declarative settings (Obsidian 1.13+): the toggle is a plain binding;
  // the hotkey row needs a custom render because it has a recorder.
  getSettingDefinitions(): SettingDefinitionItem[] {
    return [
      {
        name: "Sidebar toggle hotkey",
        desc: "Click Record shortcut, then press a modifier and key (for example, Cmd+Option+T). Press Escape to cancel.",
        render: (setting: Setting) => this.renderHotkeyRow(setting),
      },
      {
        name: "Double-click toggles sidebars",
        desc: "Double-clicking the note's text area opens or closes both sidebars. Double-clicking a word to select it also toggles them.",
        control: { type: "toggle", key: "doubleClickEnabled" },
      },
    ];
  }

  // Same recorder concept as Obsidian Quick Capture: read-only field
  // showing the current shortcut + a Record shortcut button.
  renderHotkeyRow(setting: Setting): () => void {
    const plugin = this.plugin;
    let hotkeyDisplay: HTMLInputElement | null = null;
    let keydownHandler: ((event: KeyboardEvent) => void) | null = null;
    const doc = setting.settingEl.ownerDocument;

    setting.addText((text) => {
      text.setValue(hotkeyLabel(plugin.currentHotkey()));
      text.inputEl.readOnly = true;
      text.inputEl.setAttribute("aria-label", "Current hotkey");
      hotkeyDisplay = text.inputEl;
    });

    const refreshDisplay = () => {
      if (hotkeyDisplay) {
        hotkeyDisplay.value = hotkeyLabel(plugin.currentHotkey());
      }
    };

    setting.addExtraButton((button) =>
      button
        .setIcon("lucide-rotate-ccw")
        .setTooltip("Reset to default (Cmd+Option+T)")
        .onClick(() => {
          plugin.saveHotkey(cloneDefaultHotkey());
          refreshDisplay();
        })
    );

    setting.addButton((button) => {
      const stopRecording = () => {
        if (keydownHandler) {
          doc.removeEventListener("keydown", keydownHandler, true);
          keydownHandler = null;
        }
        button.setButtonText("Record shortcut");
      };

      button.setButtonText("Record shortcut").onClick(() => {
        if (keydownHandler) {
          stopRecording();
          refreshDisplay();
          return;
        }

        button.setButtonText("Press shortcut (Esc to cancel)");
        keydownHandler = (event: KeyboardEvent) => {
          if (event.isComposing) return;

          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            stopRecording();
            refreshDisplay();
            return;
          }

          if (MODIFIER_KEYS.includes(event.key)) {
            event.preventDefault();
            event.stopPropagation();
            return;
          }

          event.preventDefault();
          event.stopPropagation();

          // Same modifier naming Obsidian's own recorder uses:
          // 'Mod' for Cmd (Mac) / Ctrl (others), then Shift, Alt.
          const modifiers: Modifier[] = [];
          if (event.metaKey || event.ctrlKey) {
            modifiers.push(event.metaKey ? "Mod" : "Ctrl");
          }
          if (event.shiftKey) modifiers.push("Shift");
          if (event.altKey) modifiers.push("Alt");

          if (modifiers.length === 0) {
            button.setButtonText("Use a modifier + key");
            return;
          }

          const key =
            KEY_NAMES[event.key] ||
            (event.key.length === 1 ? event.key.toUpperCase() : event.key);
          if (!key || key === "Dead" || key === "Unidentified") return;

          const saved = plugin.saveHotkey({ modifiers, key });
          stopRecording();
          if (saved) refreshDisplay();
        };
        doc.addEventListener("keydown", keydownHandler, true);
      });
    });

    // The keydown listener lives on the document, so tear it down when
    // the settings row is removed (tab switch, modal close).
    return () => {
      if (keydownHandler) {
        doc.removeEventListener("keydown", keydownHandler, true);
      }
    };
  }
}

// Exported for local testing outside Obsidian.
export { ToggleBothSidebarsSettingTab as SettingTab };
