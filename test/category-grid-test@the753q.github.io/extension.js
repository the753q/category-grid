// SPDX-License-Identifier: MIT-0
// Test driver for test/run.sh: opens the app grid and a folder, switches
// overview states, drags apps to the dock, saves screenshots into $CG_SHOTS
// and quits the shell.
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Shell from 'gi://Shell';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {getAppFavorites} from 'resource:///org/gnome/shell/ui/appFavorites.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

const OUT = GLib.getenv('CG_SHOTS');
const UUID = 'category-grid@the753q.github.io';

const wait = ms => new Promise(resolve => {
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
        resolve();
        return GLib.SOURCE_REMOVE;
    });
});

function shot(name) {
    return new Promise(resolve => {
        const stream = Gio.File.new_for_path(`${OUT}/${name}.png`).replace(null, false, 0, null);
        new Shell.Screenshot().screenshot(false, stream, (o, res) => {
            try {
                o.screenshot_finish(res);
            } catch (e) {
                console.log(`CGTEST screenshot error ${e}`);
            }
            stream.close(null);
            resolve();
        });
    });
}

function center(actor) {
    const [x, y] = actor.get_transformed_position();
    const [w, h] = actor.get_transformed_size();
    return [x + w / 2, y + h / 2];
}

// Drags `icon` with a virtual pointer to (ex, ey) and drops it there.
async function drag(pointer, icon, ex, ey) {
    const [sx, sy] = center(icon);
    const now = () => GLib.get_monotonic_time();

    pointer.notify_absolute_motion(now(), sx, sy);
    await wait(300);
    pointer.notify_button(now(), Clutter.BUTTON_PRIMARY, Clutter.ButtonState.PRESSED);
    await wait(300);
    for (let i = 1; i <= 25; i++) {
        pointer.notify_absolute_motion(now(), sx + (ex - sx) * i / 25, sy + (ey - sy) * i / 25);
        await wait(60);
    }
    // Wiggle while holding, like a person would: an open folder dialog pops
    // down after a moment, and the drop target only updates on motion.
    for (let i = 0; i < 6; i++) {
        await wait(250);
        pointer.notify_absolute_motion(now(), ex + (i % 2 ? 2 : -2), ey);
    }
    pointer.notify_button(now(), Clutter.BUTTON_PRIMARY, Clutter.ButtonState.RELEASED);
    await wait(1500);
}

// Drags `icon` onto the dock, next to its first app; returns whether it got pinned.
async function dragToDock(pointer, icon) {
    const dash = Main.overview.dash;
    const items = dash._box.get_children().filter(c => c.visible);
    const [ix, iy] = items[0].get_transformed_position();
    const [iw, ih] = items[0].get_transformed_size();
    const vertical = dash.height > dash.width;
    const [ex, ey] = vertical ? [ix + iw / 2, iy + ih] : [ix + iw, iy + ih / 2];
    await drag(pointer, icon, ex, ey);
    return getAppFavorites().isFavorite(icon.app.get_id());
}

const notFavorite = app => !getAppFavorites().isFavorite(app.get_id());

// Upstream GNOME starts with the overview open, Ubuntu with it closed;
// Main.overview.showApps() does nothing while the overview is already open.
function showAppGrid() {
    if (Main.overview.visible)
        Main.overview._overview.controls.dash.showAppsButton.checked = true;
    else
        Main.overview.showApps();
}

// Opens a category through its label button. The model is rebuilt whenever
// the overview shows, so look the category up by id each time.
function openCategory(view, catId) {
    const index = view._model.findIndex(e => e.cat.id === catId);
    const [, label] = view._grid.get_children()[index].get_children();
    label.emit('clicked', 1);
}

async function run() {
    try {
        // Give a scale change from test/run.sh time to apply.
        await wait(5000);
        const scale = St.ThemeContext.get_for_stage(global.stage).scale_factor;
        const monitor = Main.layoutManager.primaryMonitor;
        console.log(`CGTEST monitor ${monitor.width}x${monitor.height} ` +
            `scale=${global.display.get_monitor_scale(monitor.index)} st-scale=${scale} ` +
            `dock=${Main.overview.dash.constructor.name}`);

        showAppGrid();
        await wait(3000);
        await shot('1-grid');

        const view = Main.extensionManager.lookup(UUID)?.stateObj?._view;
        console.log(`CGTEST view=${!!view} layout=${view?._layoutKey}`);
        if (!view)
            return;
        for (const {name, apps} of view._model)
            console.log(`CGTEST category ${name}: ${apps.map(a => a.get_id()).join(', ')}`);

        // Open the biggest category through its label button.
        const big = view._model.reduce((a, b) => (b.apps.length > a.apps.length ? b : a)).cat.id;
        openCategory(view, big);
        await wait(1500);
        await shot('2-folder');
        for (const dialog of view._dialogs)
            dialog.popdown();
        await wait(1000);

        // Window picker -> app grid transitions must not shrink the icons.
        const controls = Main.overview._overview.controls;
        for (let i = 0; i < 3; i++) {
            Main.overview.hide();
            await wait(800);
            Main.overview.show();
            await wait(1200);
            controls.dash.showAppsButton.checked = true;
            await wait(1500);
            console.log(`CGTEST transition ${i} layout=${view._layoutKey} size=${view.get_size()}`);
        }
        await shot('3-after-transitions');

        const seat = Clutter.get_default_backend().get_default_seat();
        const pointer = seat.create_virtual_device(Clutter.InputDeviceType.POINTER_DEVICE);

        // Dropping an app on another tile app must not create a GNOME folder.
        const folders = new Gio.Settings({schema_id: 'org.gnome.desktop.app-folders'});
        const foldersBefore = folders.get_strv('folder-children').join(',');
        const [first, second] = view._grid.get_children()[0].get_children()[0].get_children();
        await drag(pointer, first, ...center(second));
        const foldersAfter = folders.get_strv('folder-children').join(',');
        console.log(`CGTEST drop on tile app: folders unchanged=${foldersBefore === foldersAfter}`);
        showAppGrid();
        await wait(1500);

        // Drag a tile app to the dock.
        const tileIcon = view._grid.get_children()
            .flatMap(box => box.get_children()[0].get_children())
            .find(cell => cell.app && notFavorite(cell.app));
        const tilePinned = await dragToDock(pointer, tileIcon);
        console.log(`CGTEST drag tile ${tileIcon.app.get_id()} pinned=${tilePinned}`);

        // Drag an app from an open folder to the dock.
        showAppGrid();
        await wait(1500);
        openCategory(view, big);
        await wait(1500);
        const dialog = [...view._dialogs].find(d => d._isOpen);
        const folderIcon = dialog?._view._orderedItems.find(i => notFavorite(i.app));
        const folderPinned = folderIcon ? await dragToDock(pointer, folderIcon) : false;
        console.log(`CGTEST drag folder ${folderIcon?.app.get_id()} pinned=${folderPinned}`);
    } catch (e) {
        console.log(`CGTEST error ${e}\n${e.stack}`);
    } finally {
        global.context.terminate();
    }
}

export default class TestDriver extends Extension {
    enable() {
        run();
    }

    disable() {}
}
