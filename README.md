# Category Grid

Replaces the GNOME app grid with category tiles, like the Windows 11 start
menu. Each tile shows the three apps you use most in that category; click one
to launch it. The fourth cell opens the whole category.

![Category grid](screenshots/grid.png)

Apps are sorted into categories automatically from their `.desktop` files. A
category gets a tile of its own once it holds three apps; until then they wait
in Other, so no tile sits half empty.

The apps on a tile are the ones you use most, but they don't trade places every
time one pulls ahead of another. An app keeps its cell, and gives it up only to
one you have clearly been using more, so the icons stay where your hand expects
them.

There is nothing to arrange by hand, and nothing can be: apps can't be moved
between categories, reordered or renamed.

![Folder](screenshots/folder.png)

## Installation

Requires GNOME Shell 50 or 51. Used daily on Ubuntu 26.04; upstream GNOME on
Fedora 44 and 45 passes the automated tests.

Clone this repository, then install it from inside the clone:

```bash
gnome-extensions pack
gnome-extensions install --force *.shell-extension.zip
```

Log out and back in, and turn on Category Grid in the Extensions app.
Turning it off brings the original app grid back, with your own folders and
layout as you left them.

The extension builds on GNOME Shell internals, so a new GNOME release may
break it until it is updated. GNOME won't load it on a version it doesn't
list as supported, and if it fails to start, GNOME turns it off; either way
you get the original app grid.

## Development

`test/run.sh` runs the extension in a headless GNOME Shell, isolated from your
session. It opens the grid and a folder, drags apps to the dock, saves
screenshots to `test/shots/` and prints what it checked. `test/run-fedora.sh`
does the same on upstream GNOME in a Fedora container (podman or docker);
`FEDORA` picks the release, and with it the GNOME version. Both take a screen
size and the variables listed at the top of `test/run.sh`:

```bash
MODE=ubuntu SCALE=1.5 test/run.sh 2560x1440
FEDORA=45 test/run-fedora.sh 1366x768
```

## License

[MIT-0](LICENSE): free for any use, no attribution required.
