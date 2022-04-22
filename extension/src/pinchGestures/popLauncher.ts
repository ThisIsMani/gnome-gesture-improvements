import Clutter from '@gi-types/clutter8';
import Shell from '@gi-types/shell0';
import St from '@gi-types/st1';

import {global, imports} from 'gnome-shell';

import {TouchpadPinchGesture} from '../trackers/pinchTracker';
import {easeActor} from '../utils/environment';
import {getVirtualKeyboard, IVirtualKeyboard} from '../utils/keyboard';

const Main = imports.ui.main;
const Util = imports.misc.util;

const START_OPACITY = 0;

enum CloseWindowGestureState {
	DEFAULT = 0,
	PINCH_OUT = 1,
}

declare type Type_TouchpadPinchGesture = typeof TouchpadPinchGesture.prototype;

export class PopLauncherExtension implements ISubExtension {
	private _keyboard: IVirtualKeyboard;
	private _pinchTracker: Type_TouchpadPinchGesture;
	private readonly _preview: St.Widget;

	constructor(nfingers: number[]) {
		this._keyboard = getVirtualKeyboard();

		this._preview = new St.Widget({
			reactive: false,
			style_class: 'gie-pop-launcher-preview',
			visible: false,
			opacity: START_OPACITY,
		});
		this._preview.set_pivot_point(0.5, 0.5);
		Main.layoutManager.uiGroup.add_child(this._preview);

		this._pinchTracker = new TouchpadPinchGesture({
			nfingers: nfingers,
			allowedModes: Shell.ActionMode.NORMAL,
			pinchSpeed: 0.25,
		});
		this._pinchTracker.connect('begin', this.gestureBegin.bind(this));
		this._pinchTracker.connect('update', this.gestureUpdate.bind(this));
		this._pinchTracker.connect('end', this.gestureEnd.bind(this));
	}

	destroy(): void {
		this._pinchTracker.destroy();
		this._preview.destroy();
	}

	gestureBegin(tracker: Type_TouchpadPinchGesture) {
		tracker.confirmPinch(0, [CloseWindowGestureState.DEFAULT, CloseWindowGestureState.PINCH_OUT], CloseWindowGestureState.DEFAULT);

		this._preview.set_position((global.screen_width / 2) - (725 / 2), (global.screen_height / 2) - (180 / 2));
		this._preview.set_size(725, 180);
		this._preview.show();
	}

	gestureUpdate(_tracker: unknown, progress: number): void {
		progress = Math.clamp(progress * 3, 0, 1);
		this._preview.set_scale(progress, progress);
		this._preview.opacity = Util.lerp(START_OPACITY, 255, progress);
	}

	gestureEnd(_tracker: unknown, duration: number, progress: CloseWindowGestureState) {
		switch (progress) {
			case CloseWindowGestureState.DEFAULT:
				this._animatePreview(false, duration);
				break;
			case CloseWindowGestureState.PINCH_OUT:
				this._animatePreview(true, duration, this._invokeGestureCompleteAction.bind(this));
		}
	}

	private _invokeGestureCompleteAction() {
		this._keyboard.sendKeys([Clutter.KEY_Super_L, Clutter.KEY_slash]);
	}

	private _animatePreview(gestureCompleted: boolean, duration: number, callback?: () => void) {
		easeActor(this._preview, {
			opacity: gestureCompleted ? 255 : 0,
			scaleX: gestureCompleted ? 1 : 0,
			scaleY: gestureCompleted ? 1 : 0,
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
}