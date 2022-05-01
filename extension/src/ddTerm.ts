import Clutter from '@gi-types/clutter';
import Shell from '@gi-types/shell';
import St from '@gi-types/st';
import Meta from '@gi-types/meta';

import { imports, global } from 'gnome-shell';

import { getVirtualKeyboard, IVirtualKeyboard } from './utils/keyboard';
import { TouchpadSwipeGesture } from './swipeTracker';
import { easeActor } from './utils/environment';

const Main = imports.ui.main;
const Util = imports.misc.util;

const START_OPACITY = 0;
const SnapPointThreshold = 0.1;


export class DropDownTerminal implements ISubExtension {
	private _connectHandlers: number[];
	private _keyboard: IVirtualKeyboard;
	private _preview: St.Widget;
	private _progress = 0;
	private _touchpadSwipeTracker: typeof TouchpadSwipeGesture.prototype;
	private _focusWindow?: Meta.Window | null;
	private _isTermOpen = false;

	constructor() {
		this._connectHandlers = [];
		this._keyboard = getVirtualKeyboard();

		this._preview = new St.Widget({
			reactive: false,
			style_class: 'gie-ddterm-preview',
			visible: false,
			opacity: START_OPACITY,
		});

		this._preview.set_pivot_point(0.5, 0.5);
		Main.layoutManager.uiGroup.add_child(this._preview);

		this._touchpadSwipeTracker = new TouchpadSwipeGesture(
			[4],
			Shell.ActionMode.NORMAL,
			Clutter.Orientation.VERTICAL,
			false,
			this._checkAllowedGesture.bind(this),
		);
	}

	_checkAllowedGesture(): boolean {
		return Main.actionMode === Shell.ActionMode.NORMAL && !this._touchpadSwipeTracker.isItHoldAndSwipeGesture();
	}

	apply() {
		this._connectHandlers.push(this._touchpadSwipeTracker.connect('begin', this._gestureBegin.bind(this)));
		this._connectHandlers.push(this._touchpadSwipeTracker.connect('update', this._gestureUpdate.bind(this)));
		this._connectHandlers.push(this._touchpadSwipeTracker.connect('end', this._gestureEnd.bind(this)));
	}

	_gestureBegin(): void {
		this._focusWindow = global.display.get_focus_window() as Meta.Window;
		this._isTermOpen = this._focusWindow?.get_gtk_application_id() === 'com.github.amezin.ddterm';
		this._progress = this._isTermOpen ? 1 : 0;
		this._preview.set_position(0, 32);
		this._preview.set_size(global.screen_width, global.screen_height / 2);
		this._preview.set_pivot_point(0, 0);
		this._preview.show();
	}

	_gestureUpdate(_gesture: never, _time: never, delta: number, distance: number): void {
		this._progress = Math.clamp(this._progress + (delta / distance), 0, 1);
		this._preview.set_scale(1, this._progress);
		this._preview.opacity = Util.lerp(START_OPACITY, 255, this._progress);
	}

	_gestureEnd(): void {
		if (SnapPointThreshold < (this._isTermOpen ? 1 - this._progress : this._progress)) {
			this._animatePreview(true, 400, this._invokeGestureCompleteAction.bind(this));
		} else {
			this._animatePreview(false, 100);
		}
	}

	private _invokeGestureCompleteAction() {
		this._keyboard.sendKeys([Clutter.KEY_F12]);
	}

	private _animatePreview(gestureCompleted: boolean, duration: number, callback?: () => void) {
		easeActor(this._preview, {
			opacity: gestureCompleted ? 255 : 0,
			scaleY: gestureCompleted !== this._isTermOpen ? 1 : 0,
			duration,
			mode: Clutter.AnimationMode.EASE_OUT_QUAD,
			onStopped: () => {
				if (callback)
					callback();
				this._gestureAnimationDone();
			},
		});
	}

	private _gestureAnimationDone() {
		this._preview.hide();
		this._preview.opacity = START_OPACITY;
		this._preview.set_scale(1, 1);
	}

	destroy(): void {
		this._connectHandlers.forEach(handle => this._touchpadSwipeTracker.disconnect(handle));
		this._touchpadSwipeTracker.destroy();
		this._connectHandlers = [];
		this._preview.destroy();
	}

}