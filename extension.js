// SPDX-License-Identifier: MIT-0
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as AppDisplay from 'resource:///org/gnome/shell/ui/appDisplay.js';
import * as DND from 'resource:///org/gnome/shell/ui/dnd.js';
import * as IconGrid from 'resource:///org/gnome/shell/ui/iconGrid.js';
import * as ParentalControlsManager from 'resource:///org/gnome/shell/misc/parentalControlsManager.js';
import {ExtensionState} from 'resource:///org/gnome/shell/misc/extensionUtils.js';
import {ControlsState} from 'resource:///org/gnome/shell/ui/overviewControls.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

// First matching entry wins, so more specific categories go first
// (e.g. "Development;Utility" lands in Programming, not Utilities).
// Names come from the system's translated menu directories, like GNOME's
// own default folders; `fallback` is only used if the directory is missing.
const CATEGORIES = [
    {id: 'programming', directory: 'Development.directory', fallback: 'Programming', match: ['Development', 'IDE']},
    {id: 'games', directory: 'Game.directory', fallback: 'Games', match: ['Game']},
    {id: 'graphics', directory: 'Graphics.directory', fallback: 'Graphics', match: ['Graphics']},
    {id: 'media', directory: 'AudioVideo.directory', fallback: 'Sound & Video', match: ['AudioVideo', 'Audio', 'Video']},
    {id: 'office', directory: 'Office.directory', fallback: 'Office', match: ['Office']},
    {id: 'science', directory: 'GnomeScience.directory', fallback: 'Science', match: ['Science']},
    {id: 'education', directory: 'Education.directory', fallback: 'Education', match: ['Education']},
    {id: 'internet', directory: 'Network.directory', fallback: 'Internet', match: ['Network', 'WebBrowser', 'Email', 'Chat', 'InstantMessaging']},
    {id: 'settings', directory: 'Settings.directory', fallback: 'Preferences', match: ['Settings']},
    {id: 'system', directory: 'X-GNOME-Shell-System.directory', fallback: 'System', match: ['System', 'Monitor', 'PackageManager', 'TerminalEmulator']},
    {id: 'utilities', directory: 'X-GNOME-Shell-Utilities.directory', fallback: 'Utilities', match: ['Utility', 'Accessibility', 'Accessories']},
];
const OTHER = {id: 'other', directory: 'X-GNOME-Other.directory', fallback: 'Other', match: []};
// Tile order, independent of the matching priority above: everyday apps
// first, related categories next to each other, system ones last.
const DISPLAY_ORDER = [
    'internet', 'office', 'media', 'graphics',
    'games', 'programming', 'science', 'education',
    'utilities', 'system', 'settings', 'other',
];

const MIN_COLUMNS = 4;
// Only used when even the widest grid does not fit at the preferred size.
const FALLBACK_ICON_SIZES = [40, 32];
// Same proportion as the small icons in GNOME's folder icons.
const SUBICON_FRACTION = 0.4;
const TILE_FADE_TIME = 100;
const TOOLTIP_SHOW_TIME = 150;

// The hidden GNOME grid still reacts to every app drag. Its drag motion
// handler throws on its never-laid-out pages, which aborts the drag update
// before the dock gets to accept the icon; on drop it would also save its
// empty layout over the user's app-picker-layout. Set on the AppDisplay
// instance while enabled.
const HIDDEN_GRID_OVERRIDES = {
    _onDragMotion: () => DND.DragMotionResult.CONTINUE,
    _ensurePlaceholder: () => {},
    _savePages: () => {},
};

const FOLDER_SCHEMA = 'org.gnome.desktop.app-folders.folder';
const FOLDER_PATH = '/org/gnome/desktop/app-folders/folders/';
const DOCK_SCHEMA = 'org.gnome.shell.extensions.dash-to-dock';
const DOCK_UUIDS = ['ubuntu-dock@ubuntu.com', 'dash-to-dock@micxgx.gmail.com'];
// Upstream GNOME's app grid uses 96px icons and its dash at most 64px.
// Ubuntu patches both and exports its own default as Main.defaultIconSize.
const GRID_ICON_SIZE = Main.defaultIconSize ?? 96;
const DASH_MAX_ICON_SIZE = 64;

function categoryName(cat) {
    return Shell.util_get_translated_folder_name(cat.directory) ?? cat.fallback;
}

function buildModel() {
    const appSys = Shell.AppSystem.get_default();
    const usage = Shell.AppUsage.get_default();
    const parental = ParentalControlsManager.getDefault();
    const groups = new Map([...CATEGORIES, OTHER].map(c => [c.id, []]));
    const seen = new Set();

    for (const info of appSys.get_installed()) {
        let id;
        try {
            id = info.get_id();
        } catch {
            continue;
        }
        if (!id || seen.has(id) || !info.should_show() || !parental.shouldShowApp(info))
            continue;

        const app = appSys.lookup_app(id);
        if (!app)
            continue;
        seen.add(id);

        const cats = (info.get_categories() ?? '').split(';');
        const cat = CATEGORIES.find(c => c.match.some(m => cats.includes(m))) ?? OTHER;
        groups.get(cat.id).push(app);
    }

    const model = [];
    for (const id of DISPLAY_ORDER) {
        const cat = [...CATEGORIES, OTHER].find(c => c.id === id);
        const apps = groups.get(id);
        if (apps.length === 0)
            continue;
        apps.sort((a, b) =>
            usage.compare(a.get_id(), b.get_id()) ||
            a.get_name().localeCompare(b.get_name()));
        model.push({cat, name: categoryName(cat), apps});
    }
    return model;
}

// Settings of the active Ubuntu Dock / Dash to Dock, or null. Ubuntu Dock's
// schema is installed system-wide; Dash to Dock from extensions.gnome.org
// ships it in its own schemas/ directory.
function dockSettings() {
    const dock = DOCK_UUIDS.map(uuid => Main.extensionManager.lookup(uuid))
        .find(ext => ext?.state === ExtensionState.ACTIVE);
    if (!dock)
        return null;

    const defaultSource = Gio.SettingsSchemaSource.get_default();
    let source = defaultSource;
    const schemaDir = dock.dir.get_child('schemas');
    if (schemaDir.query_exists(null)) {
        try {
            source = Gio.SettingsSchemaSource.new_from_directory(
                schemaDir.get_path(), defaultSource, false);
        } catch {}
    }
    const schema = source.lookup(DOCK_SCHEMA, true);
    return schema ? new Gio.Settings({settings_schema: schema}) : null;
}

// Start at MIN_COLUMNS and widen the grid until all rows fit vertically.
// Returns 0 if not even a single row fits.
function chooseColumns(count, width, height, tile, columnGap, rowGap) {
    const minCols = Math.min(MIN_COLUMNS, count);
    for (let cols = minCols; cols <= count; cols++) {
        const rows = Math.ceil(count / cols);
        if (cols * tile.width + (cols - 1) * columnGap <= width * 0.95 &&
            rows * tile.height + (rows - 1) * rowGap <= height * 0.95)
            return cols;
    }
    return 0;
}

// Apply a theme length (e.g. `spacing: 4px` in stylesheet.css) to a grid layout.
function bindSpacing(actor, layout, columnProp, rowProp) {
    actor.connect('style-changed', () => {
        const node = actor.get_theme_node();
        layout.column_spacing = node.get_length(columnProp);
        layout.row_spacing = node.get_length(rowProp);
    });
}

// GNOME's own folder view (paged 3x3 grid), fed with a category's apps
// instead of the app-folders settings. Reordering and removing are disabled
// because the order comes from usage.
const CategoryFolderView = GObject.registerClass(
class CategoryFolderView extends AppDisplay.FolderView {
    _init(folder, id, parentView, apps) {
        this._categoryApps = apps;
        super._init(folder, id, parentView);
    }

    _loadApps() {
        this._apps = [...this._categoryApps];
        return this._apps.map(app =>
            this._items.get(app.get_id()) ?? new AppDisplay.AppIcon(app));
    }

    acceptDrop() {
        return false;
    }

    addApp() {}

    removeApp() {}
});

const CategoryView = GObject.registerClass(
class CategoryView extends St.Widget {
    _init(appDisplay) {
        super._init({
            layout_manager: new Clutter.BinLayout(),
            x_expand: true,
            y_expand: true,
        });
        this._appDisplay = appDisplay;

        const gridLayout = new Clutter.GridLayout();
        this._grid = new St.Widget({
            style_class: 'cg-grid',
            layout_manager: gridLayout,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        bindSpacing(this._grid, gridLayout, 'column-spacing', 'row-spacing');
        this.add_child(this._grid);

        this._tooltip = new St.Label({style_class: 'dash-label', visible: false});
        Main.layoutManager.addTopChrome(this._tooltip);

        this._model = null;
        this._modelKey = null;
        this._layoutKey = null;
        this._dialogs = new Set();
        this._rebuildId = 0;
        this._modelDirty = true;

        Shell.AppSystem.get_default().connectObject('installed-changed',
            () => this._queueRebuild(true), this);
        Main.overview.connectObject(
            'showing', () => this._queueRebuild(true),
            'hiding', () => this._popdownDialogs(),
            this);
        this._stateAdjustment = Main.overview._overview.controls._stateAdjustment;
        this._stateAdjustment.connectObject('notify::value', () => {
            if (this._inAppGrid())
                this._queueRebuild(false);
        }, this);
        // The dock may be enabled, disabled or swapped after this extension.
        this._dockSettings = null;
        this._updateDockSettings();
        Main.extensionManager.connectObject('extension-state-changed',
            (manager, ext) => {
                if (DOCK_UUIDS.includes(ext.uuid))
                    this._updateDockSettings();
            }, this);
        // Font, text scaling and theme changes all change the tile size.
        St.ThemeContext.get_for_stage(global.stage).connectObject('changed',
            () => this._queueRebuild(false, true), this);

        this.connect('destroy', this._onDestroy.bind(this));
    }

    _onDestroy() {
        if (this._rebuildId) {
            GLib.source_remove(this._rebuildId);
            this._rebuildId = 0;
        }
        this._dockSettings?.disconnectObject(this);
        this._dockSettings = null;
        Main.extensionManager.disconnectObject(this);
        this._stateAdjustment.disconnectObject(this);
        St.ThemeContext.get_for_stage(global.stage).disconnectObject(this);
        Main.layoutManager.removeChrome(this._tooltip);
        this._tooltip.destroy();
        this._tooltip = null;
    }

    vfunc_allocate(box) {
        super.vfunc_allocate(box);
        const key = `${Math.round(box.get_width())}x${Math.round(box.get_height())}`;
        if (key !== this._allocKey) {
            this._allocKey = key;
            this._queueRebuild(false);
        }
    }

    vfunc_unmap() {
        this._popdownDialogs();
        this._hideTooltip();
        super.vfunc_unmap();
    }

    _updateDockSettings() {
        this._dockSettings?.disconnectObject(this);
        this._dockSettings = dockSettings();
        this._dockSettings?.connectObject('changed::dash-max-icon-size',
            () => this._queueRebuild(false), this);
        this._queueRebuild(false);
    }

    // The smaller of the default app grid icon size and the dock's maximum
    // icon size. Not the live sizes: the hidden grid's adapts to whatever box
    // it last got, and the dash shrinks its icons as favorites are added.
    _preferredIconSize() {
        const dockSize = this._dockSettings?.get_int('dash-max-icon-size') || DASH_MAX_ICON_SIZE;
        return Math.min(GRID_ICON_SIZE, dockSize);
    }

    _inAppGrid() {
        return this._stateAdjustment.value === ControlsState.APP_GRID;
    }

    _queueRebuild(modelChanged, styleChanged = false) {
        this._modelDirty ||= modelChanged;
        if (styleChanged)
            this._layoutKey = null;
        if (this._rebuildId)
            return;
        this._rebuildId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._rebuildId = 0;
            this._rebuild();
            return GLib.SOURCE_REMOVE;
        });
    }

    _rebuild() {
        if (this._modelDirty || !this._model) {
            this._model = buildModel();
            this._modelDirty = false;
        }

        // While the overview animates into the app grid, the app display box
        // shrinks and grows with the workspaces view; laying out then would pick
        // a smaller size. Wait for the final state (unless nothing is built yet).
        if (this._layoutKey && !this._inAppGrid())
            return;

        const [width, height] = this.get_size();
        if (width <= 0 || height <= 0 || this._model.length === 0)
            return;
        // Rebuilding while a folder is open would pull its source tile away.
        if ([...this._dialogs].some(d => d._isOpen))
            return;

        const node = this._grid.get_theme_node();
        const columnGap = node.get_length('column-spacing');
        const rowGap = node.get_length('row-spacing');
        const preferred = this._preferredIconSize();
        const sizes = [preferred, ...FALLBACK_ICON_SIZES.filter(s => s < preferred)];
        const count = this._model.length;

        let iconSize, cols, tile;
        for (iconSize of sizes) {
            tile = this._measureTile(iconSize);
            cols = chooseColumns(count, width, height, tile, columnGap, rowGap);
            if (cols)
                break;
        }
        cols ||= Math.max(Math.min(MIN_COLUMNS, count), Math.ceil(Math.sqrt(count)));

        const modelKey = this._model.map(({cat, name, apps}) =>
            `${cat.id}=${name}:${apps.map(a => a.get_id()).join(',')}`).join('|');
        const layoutKey = `${iconSize}/${cols}/${tile.width}x${tile.height}`;
        if (modelKey === this._modelKey && layoutKey === this._layoutKey)
            return;
        this._modelKey = modelKey;
        this._layoutKey = layoutKey;

        this._grid.destroy_all_children();
        const layout = this._grid.layout_manager;
        this._model.forEach((entry, i) => {
            const box = this._createTile(entry, iconSize);
            box.width = tile.width;
            layout.attach(box, i % cols, Math.floor(i / cols), 1, 1);
        });
    }

    // Like GNOME's icon grid, measure a real tile instead of guessing: its size
    // depends on the theme's paddings, the font and the text scaling factor.
    _measureTile(iconSize) {
        const entry = this._model.reduce((a, b) => (b.apps.length > a.apps.length ? b : a));
        const probe = this._createTile(entry, iconSize);
        probe.opacity = 0;
        this.add_child(probe);
        const [body, label] = probe.get_children();
        const [, width] = body.get_preferred_width(-1);
        const [, bodyHeight] = body.get_preferred_height(width);
        const [, labelHeight] = label.get_preferred_height(width);
        probe.destroy();
        return {width: Math.ceil(width), height: Math.ceil(bodyHeight + labelHeight)};
    }

    _createTile(entry, iconSize) {
        const {name, apps} = entry;
        const box = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL});

        const tileLayout = new Clutter.GridLayout({
            row_homogeneous: true,
            column_homogeneous: true,
        });
        // .app-folder gives the tile the theme's folder background.
        const tile = new St.Widget({
            style_class: 'app-folder cg-tile',
            layout_manager: tileLayout,
        });
        bindSpacing(tile, tileLayout, 'spacing', 'spacing');

        const openFolder = () => this._openFolder(tile, entry);

        const overflow = apps.length > 4;
        const direct = apps.slice(0, overflow ? 3 : 4);
        for (let i = 0; i < 4; i++) {
            let cell;
            if (i < direct.length)
                cell = this._createAppCell(direct[i], iconSize);
            else if (overflow)
                cell = this._createMoreCell(name, apps, iconSize, openFolder);
            else
                cell = this._createEmptyCell(iconSize);
            tileLayout.attach(cell, i % 2, Math.floor(i / 2), 1, 1);
        }

        // .overview-tile gives the label the same text color, hover and
        // focus ring as app icons in the grid.
        const label = new St.Button({
            style_class: 'overview-tile cg-label',
            label: name,
            x_expand: true,
            can_focus: true,
        });
        label.connect('clicked', openFolder);

        box.add_child(tile);
        box.add_child(label);
        return box;
    }

    _openFolder(tile, entry) {
        this._hideTooltip();
        const {cat, name, apps} = entry;

        if (!tile._cgDialog) {
            const folder = new Gio.Settings({
                schema_id: FOLDER_SCHEMA,
                path: `${FOLDER_PATH}cg-${cat.id}/`,
            });
            // The folder name is fixed to the category; the dialog's rename button is hidden.
            if (folder.get_string('name') !== name)
                folder.set_string('name', name);
            if (folder.get_boolean('translate'))
                folder.set_boolean('translate', false);

            // AppFolderDialog zooms out of its source and reads source.view / source.name,
            // which a FolderIcon would normally provide.
            tile.name = name;
            tile.view = new CategoryFolderView(folder, `cg-${cat.id}`, this._appDisplay, apps);

            const dialog = new AppDisplay.AppFolderDialog(tile, folder, this._appDisplay);
            this._appDisplay.addFolderDialog(dialog);
            // Keep the rename button's space so the title stays centered, but make it
            // invisible and unusable.
            Object.assign(dialog._editButton, {opacity: 0, reactive: false, can_focus: false});
            // Dropping an app outside the dialog must not remove it from the category.
            dialog.acceptDrop = () => {
                dialog.popdown();
                return false;
            };
            dialog.connect('open-state-changed', (d, isOpen) => {
                tile.ease({
                    opacity: isOpen ? 0 : 255,
                    duration: TILE_FADE_TIME,
                    delay: isOpen ? 0 : TILE_FADE_TIME,
                    mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                });
            });
            dialog.connect('destroy', () => this._dialogs.delete(dialog));
            tile.connect('destroy', () => dialog.destroy());
            this._dialogs.add(dialog);
            tile._cgDialog = dialog;
        }

        // GNOME focuses the (now hidden) rename button on open; focus the dialog
        // itself so arrow keys still navigate but nothing is outlined.
        const dialog = tile._cgDialog;
        dialog.popup();
        if (dialog._isOpen)
            global.stage.set_key_focus(dialog);
    }

    _popdownDialogs() {
        for (const dialog of this._dialogs)
            dialog.popdown();
    }

    _createAppCell(app, iconSize) {
        const icon = new AppDisplay.AppIcon(app, {
            showLabel: false,
            expandTitleOnHover: false,
        });
        icon.icon.setIconSize(iconSize);
        // GNOME would treat a drop on this icon as "create a folder" in the
        // hidden grid (and crash on the missing label while previewing it).
        icon._canAccept = () => false;
        // Without a visible label, screen readers need the name explicitly.
        icon.accessible_name = app.get_name();
        this._addTooltip(icon, app.get_name());
        return icon;
    }

    // Same geometry as an app cell (an .overview-tile around a BaseIcon), but
    // the icon is a 2x2 preview of the remaining apps, like GNOME folder icons.
    _createMoreCell(name, apps, iconSize, openFolder) {
        const icon = new IconGrid.BaseIcon(name, {
            showLabel: false,
            setSizeManually: true,
            createIcon: size => this._createSubIcons(apps.slice(3, 7), size),
        });
        icon.setIconSize(iconSize);

        const button = new St.Button({
            style_class: 'overview-tile',
            can_focus: true,
            accessible_name: name,
            child: icon,
        });
        button.connect('clicked', openFolder);
        this._addTooltip(button, `${name} (${apps.length})`);
        return button;
    }

    _createSubIcons(apps, size) {
        const layout = new Clutter.GridLayout({
            row_homogeneous: true,
            column_homogeneous: true,
        });
        const grid = new St.Widget({
            layout_manager: layout,
            style: `width: ${size}px; height: ${size}px;`,
        });
        const subSize = Math.floor(SUBICON_FRACTION * size);
        apps.forEach((app, i) => {
            const bin = new St.Bin({
                style: `width: ${subSize}px; height: ${subSize}px;`,
                child: app.create_icon_texture(subSize),
            });
            layout.attach(bin, i % 2, Math.floor(i / 2), 1, 1);
        });
        return grid;
    }

    _createEmptyCell(iconSize) {
        const icon = new IconGrid.BaseIcon('', {
            showLabel: false,
            setSizeManually: true,
            createIcon: size => new St.Widget({style: `width: ${size}px; height: ${size}px;`}),
        });
        icon.setIconSize(iconSize);
        return new St.Bin({style_class: 'overview-tile cg-empty', child: icon});
    }

    _addTooltip(actor, text) {
        actor.connect('notify::hover', () => {
            if (actor.hover)
                this._showTooltip(actor, text);
            else
                this._hideTooltip();
        });
        actor.connect('destroy', () => this._hideTooltip());
    }

    // Positioned like the dash's app labels, using the theme's .dash-label offset.
    _showTooltip(actor, text) {
        this._tooltip.text = text;
        this._tooltip.opacity = 0;
        this._tooltip.show();
        const [x, y] = actor.get_transformed_position();
        const [w] = actor.get_transformed_size();
        const [, tipW] = this._tooltip.get_preferred_width(-1);
        const [, tipH] = this._tooltip.get_preferred_height(-1);
        const offset = this._tooltip.get_theme_node().get_length('-y-offset');
        this._tooltip.set_position(
            Math.round(x + (w - tipW) / 2),
            Math.round(Math.max(0, y - tipH - offset)));
        this._tooltip.ease({
            opacity: 255,
            duration: TOOLTIP_SHOW_TIME,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });
    }

    _hideTooltip() {
        if (!this._tooltip?.visible)
            return;
        this._tooltip.remove_all_transitions();
        this._tooltip.hide();
    }
});

export default class CategoryGridExtension extends Extension {
    enable() {
        const appDisplay = Main.overview._overview.controls.appDisplay;
        // Build the view before touching GNOME's grid: if a future GNOME
        // breaks this, enable() throws, GNOME marks the extension as failed
        // (without calling disable()) and the original grid must still be there.
        const view = new CategoryView(appDisplay);
        appDisplay.add_child(view);
        // Hide GNOME's paged grid but keep AppDisplay itself: the overview
        // still positions, shows and animates it when switching to the app grid.
        appDisplay._box.hide();
        Object.assign(appDisplay, HIDDEN_GRID_OVERRIDES);
        this._appDisplay = appDisplay;
        this._view = view;
    }

    disable() {
        this._view?.destroy();
        this._view = null;
        if (this._appDisplay) {
            for (const name of Object.keys(HIDDEN_GRID_OVERRIDES))
                delete this._appDisplay[name];
            this._appDisplay._box.show();
        }
        this._appDisplay = null;
    }
}
