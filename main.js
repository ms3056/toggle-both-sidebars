'use strict';

const { Plugin, PluginSettingTab, Setting, Notice } = require('obsidian');

// Obsidian's own sidebar toggle commands. Calling these instead of poking
// the layout manually means behavior (animations, autohide/CSS hooks,
// mobile drawers) matches the built-in hotkeys exactly.
const CMD_LEFT = 'app:toggle-left-sidebar';
const CMD_RIGHT = 'app:toggle-right-sidebar';

const COMMAND_ID = 'toggle-both-sidebars';
// Default hotkey: Cmd+Option+T (Ctrl+Alt+T on Windows/Linux, via 'Mod').
const DEFAULT_HOTKEY = { modifiers: ['Mod', 'Alt'], key: 'T' };

const MODIFIER_KEYS = ['Control', 'Alt', 'Shift', 'Meta'];
// Normalize a few event.key values the same way Obsidian's own recorder does.
const KEY_NAMES = {
	' ': 'Space',
	ArrowDown: 'Down',
	ArrowLeft: 'Left',
	ArrowRight: 'Right',
	ArrowUp: 'Up',
	'+': 'Plus',
};
const MOD_LABELS = {
	Mod: 'Cmd',
	Ctrl: 'Ctrl',
	Alt: 'Option',
	Shift: 'Shift',
	Meta: 'Cmd',
};

function hotkeyLabel(hotkey) {
	if (!hotkey) return 'None';
	const mods = (hotkey.modifiers || []).map((m) => MOD_LABELS[m] || m);
	return [...mods, hotkey.key].join('+');
}

module.exports = class ToggleBothSidebars extends Plugin {
	async onload() {
		await this.loadSettings();

		// Command with a default hotkey (Cmd+Option+T) and native hotkey
		// support: it appears in the Command palette and in
		// Settings -> Hotkeys, where the user can also rebind it.
		this.addCommand({
			id: COMMAND_ID,
			name: 'Toggle both sidebars',
			hotkeys: [{ modifiers: [...DEFAULT_HOTKEY.modifiers], key: DEFAULT_HOTKEY.key }],
			callback: () => this.toggleBoth(),
		});

		// Double-click on the note text area (left mouse button).
		// Uses the browser's native dblclick event, so OS double-click
		// timing applies and single clicks are untouched.
		this.registerDomEvent(document, 'dblclick', (evt) => {
			if (!this.settings.doubleClickEnabled) return;
			if (evt.button !== 0) return; // left mouse button only
			const el = evt.target;
			if (!el || typeof el.closest !== 'function') return;
			// Only the markdown content area: edit mode (.markdown-source-view)
			// and reading mode (.markdown-preview-view). File lists, tab bars,
			// ribbon, and settings panels stay unaffected.
			if (el.closest('.markdown-source-view, .markdown-preview-view')) {
				this.toggleBoth();
			}
		});

		this.addSettingTab(new ToggleBothSidebarsSettingTab(this.app, this));
	}

	onunload() {}

	toggleBoth() {
		// Each sidebar flips its own state: open -> closed, closed -> open.
		this.runBuiltin(CMD_LEFT, this.app.workspace.leftSplit);
		this.runBuiltin(CMD_RIGHT, this.app.workspace.rightSplit);
	}

	// Prefer Obsidian's built-in command; fall back to the sidedock's own
	// toggle() method only if the command is ever missing.
	runBuiltin(id, split) {
		if (this.app.commands && this.app.commands.commands[id]) {
			this.app.commands.executeCommandById(id);
		} else if (split && typeof split.toggle === 'function') {
			split.toggle();
		}
	}

	// The currently active hotkey: a custom one if the user recorded it,
	// otherwise Obsidian's default for the command, otherwise our fallback.
	currentHotkey() {
		const mgr = this.app.hotkeyManager;
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
	saveHotkey(hotkey) {
		const mgr = this.app.hotkeyManager;
		if (!mgr) {
			new Notice('This Obsidian version does not support changing hotkeys from a plugin.');
			return false;
		}
		try {
			mgr.setHotkeys(COMMAND_ID, [hotkey]);
			return true;
		} catch (err) {
			console.error('ToggleBothSidebars: could not save hotkey', err);
			new Notice('Could not save the hotkey. Check the console for details.');
			return false;
		}
	}

	async loadSettings() {
		this.settings = Object.assign(
			{ doubleClickEnabled: true },
			await this.loadData()
		);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
};

class ToggleBothSidebarsSettingTab extends PluginSettingTab {
	constructor(app, plugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	// Declarative settings (Obsidian 1.13+): the toggle is a plain binding;
	// the hotkey row needs a custom render because it has a recorder.
	getSettingDefinitions() {
		return [
			{
				name: 'Sidebar toggle hotkey',
				desc: 'Click Record shortcut, then press a modifier and key (for example, Cmd+Option+T). Press Escape to cancel.',
				render: (setting) => this.renderHotkeyRow(setting),
			},
			{
				name: 'Double-click toggles sidebars',
				desc: "Double-clicking the note's text area opens or closes both sidebars. Double-clicking a word to select it also toggles them.",
				control: { type: 'toggle', key: 'doubleClickEnabled' },
			},
		];
	}

	// Same recorder concept as Obsidian Quick Capture: read-only field
	// showing the current shortcut + a Record shortcut button.
	renderHotkeyRow(setting) {
		const plugin = this.plugin;
		let hotkeyDisplay;
		let keydownHandler = null;
		const doc = setting.settingEl.ownerDocument;

		setting.addText((text) => {
			text.setValue(hotkeyLabel(plugin.currentHotkey()));
			text.inputEl.readOnly = true;
			text.inputEl.setAttribute('aria-label', 'Current hotkey');
			hotkeyDisplay = text.inputEl;
		});

		const refreshDisplay = () => {
			if (hotkeyDisplay) {
				hotkeyDisplay.value = hotkeyLabel(plugin.currentHotkey());
			}
		};

		setting.addExtraButton((button) =>
			button
				.setIcon('lucide-rotate-ccw')
				.setTooltip('Reset to default (Cmd+Option+T)')
				.onClick(() => {
					plugin.saveHotkey({
						modifiers: [...DEFAULT_HOTKEY.modifiers],
						key: DEFAULT_HOTKEY.key,
					});
					refreshDisplay();
				})
		);

		setting.addButton((button) => {
			const stopRecording = () => {
				if (keydownHandler) {
					doc.removeEventListener('keydown', keydownHandler, true);
					keydownHandler = null;
				}
				button.setButtonText('Record shortcut');
			};

			button
				.setButtonText('Record shortcut')
				.onClick(() => {
					if (keydownHandler) {
						stopRecording();
						refreshDisplay();
						return;
					}

					button.setButtonText('Press shortcut (Esc to cancel)');
					keydownHandler = (event) => {
						if (event.isComposing) return;

						if (event.key === 'Escape') {
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
						const modifiers = [];
						if (event.metaKey || event.ctrlKey) {
							modifiers.push(event.metaKey ? 'Mod' : 'Ctrl');
						}
						if (event.shiftKey) modifiers.push('Shift');
						if (event.altKey) modifiers.push('Alt');

						if (modifiers.length === 0) {
							button.setButtonText('Use a modifier + key');
							return;
						}

						const key =
							KEY_NAMES[event.key] ||
							(event.key.length === 1 ? event.key.toUpperCase() : event.key);
						if (!key || key === 'Dead' || key === 'Unidentified') return;

						const saved = plugin.saveHotkey({ modifiers, key });
						stopRecording();
						if (saved) refreshDisplay();
					};
					doc.addEventListener('keydown', keydownHandler, true);
				});
		});

		// The keydown listener lives on the document, so tear it down when
		// the settings row is removed (tab switch, modal close).
		return () => {
			if (keydownHandler) {
				doc.removeEventListener('keydown', keydownHandler, true);
			}
		};
	}
}

// Exported for local testing outside Obsidian.
module.exports.SettingTab = ToggleBothSidebarsSettingTab;
