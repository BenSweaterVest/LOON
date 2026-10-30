/**
 * Navigation helpers shared by views. A view can install a leave guard
 * (async () => boolean) to stop navigation away, e.g. with unsaved changes;
 * give it a `dirty()` method to also warn on tab close.
 */

let guard = null;

export function setLeaveGuard(fn) {
    guard = fn;
}

export function getLeaveGuard() {
    return guard;
}

export function navigate(path) {
    location.hash = `#${path}`;
}
