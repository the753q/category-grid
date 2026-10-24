# Upstream GNOME (Fedora) for test/run-fedora.sh, with a few apps so that
# several categories show up.
FROM registry.fedoraproject.org/fedora:44

RUN dnf -y install --setopt=install_weak_deps=False \
        gnome-shell mutter python3-gobject mesa-dri-drivers dbus-daemon dbus-tools dconf \
        gnome-menus fuse3 gnome-shell-extension-dash-to-dock \
        nautilus gnome-calculator gnome-text-editor gnome-system-monitor \
        ptyxis loupe baobab gnome-disk-utility gnome-clocks gnome-calendar \
        gnome-characters gnome-font-viewer evince \
    && dnf clean all \
    && useradd -m tester

USER tester
