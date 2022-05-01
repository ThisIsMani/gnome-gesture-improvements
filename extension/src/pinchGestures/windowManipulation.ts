import Clutter from '@gi-types/clutter';
import Meta from '@gi-types/meta';
import Shell from '@gi-types/shell';
import St from '@gi-types/st';

import { global, imports } from 'gnome-shell';

import { PinchGestureType } from '../../common/settings';
import { TouchpadPinchGesture } from '../trackers/pinchTracker';
import { easeActor } from '../utils/environment';
import { getVirtualKeyboard, IVirtualKeyboard } from '../utils/keyboard';

const Main = imports.ui.main;
const Util = imports.misc.util;

const START_OPACITY = 0;

enum CloseWindowGestureState {
	PINCH_IN = -1,
	DEFAULT = 0,
	PINCH_OUT = 1,
}

enum EndAction {
	CLOSE,
	MAXIMIZE,
	MINIMIZE,
}

declare type Type_TouchpadPinchGesture = typeof TouchpadPinchGesture.prototype;

export class WindowManupulationGesture implements ISubExtension {
	private _closeType: PinchGestureType.CLOSE_DOCUMENT | PinchGestureType.CLOSE_WINDOW;
	private _keyboard: IVirtualKeyboard;
	private _pinchTracker: Type_TouchpadPinchGesture;
	private _preview: St.Widget;
	private _focusWindow?: Meta.Window | null;
	private _maximizedBox: Meta.Rectangle;
	private _endAction: EndAction;
	private _windowFrame: Meta.Rectangle;
	private _isAlredyMaximized: boolean;

	constructor(nfingers: number[], closeType: PinchGestureType.CLOSE_DOCUMENT | PinchGestureType.CLOSE_WINDOW) {
		this._closeType = closeType;
		this._keyboard = getVirtualKeyboard();
		this._endAction = EndAction.CLOSE;
		this._isAlredyMaximized = false;
		this._windowFrame = new Meta.Rectangle();
		this._maximizedBox = new Meta.Rectangle();

		this._preview = new St.Widget({
			reactive: false,
			style_class: 'gie-minimize-window-preview',
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
		this._focusWindow = global.display.get_focus_window() as Meta.Window | null;
		if (!this._focusWindow)	return;

		this._maximizedBox = this.getMaximizedBox(this._focusWindow);
		this._isAlredyMaximized = this._focusWindow?.get_maximized() === Meta.MaximizeFlags.BOTH;

		tracker.confirmPinch(0, [CloseWindowGestureState.PINCH_IN, CloseWindowGestureState.DEFAULT, CloseWindowGestureState.PINCH_OUT], CloseWindowGestureState.DEFAULT);

		this._windowFrame = this._focusWindow.get_frame_rect();
		this._preview.set_position(this._windowFrame.x, this._windowFrame.y);
		this._preview.set_size(this._windowFrame.width, this._windowFrame.height);
		this._preview.show();
	}

	gestureUpdate(_tracker: unknown, progress: number): void {
		progress = progress - CloseWindowGestureState.PINCH_IN;
		if (progress <= 1) {
			progress *= progress * progress;
			this._endAction = this._isAlredyMaximized && progress >= 0.8 ? EndAction.MINIMIZE : EndAction.CLOSE;
			this._preview.set_style(`background-color: rgba(${Util.lerp(255, 128, progress)}, ${Util.lerp(128, 174, progress)}, ${Util.lerp(128, 255, progress)}, 0.5)`);
			this._preview.set_scale(progress, progress);
			this._preview.opacity = Util.lerp(START_OPACITY, 255, progress);
		} else if (!this._isAlredyMaximized) {
			this._preview.opacity = 255;
			this._preview.set({
				x: Util.lerp(this._windowFrame.x, this._maximizedBox.x, progress - 1),
				y: Util.lerp(this._windowFrame.y, this._maximizedBox.y, progress - 1),
				width: Util.lerp(this._windowFrame.width, this._maximizedBox.width, progress - 1),
				height: Util.lerp(this._windowFrame.height, this._maximizedBox.height, progress - 1),
			});
		} else {
			this._preview.opacity = 255;
		}
	}

	getMaximizedBox(window: Meta.Window) {
		const monitor = window.get_monitor();
		const maximizedBox = Main.layoutManager.getWorkAreaForMonitor(monitor);
		if (!window.is_fullscreen())
			return maximizedBox;

		const height = Math.round(maximizedBox.height * 0.025);
		maximizedBox.y += height;
		maximizedBox.height -= 2 * height;
		return maximizedBox;
	}

	gestureEnd(_tracker: unknown, duration: number, progress: CloseWindowGestureState) {
		switch (progress) {
			case CloseWindowGestureState.DEFAULT:
				this._animatePreview(false, duration);
				break;
			case CloseWindowGestureState.PINCH_IN:
				this._animatePreview(true, duration, this._invokeGestureCompleteAction.bind(this));
				break;
			case CloseWindowGestureState.PINCH_OUT:
				this._endAction = EndAction.MAXIMIZE;
				this._animatePreview(true, duration, this._invokeGestureCompleteAction.bind(this));
				break;
		}
	}

	private _invokeGestureCompleteAction() {
		switch (this._closeType) {
			case PinchGestureType.CLOSE_WINDOW:
				switch (this._endAction) {
					case EndAction.CLOSE:
						this._focusWindow?.delete(Clutter.get_current_event_time());
						break;
					case EndAction.MINIMIZE:
						this._focusWindow?.unmaximize(Meta.MaximizeFlags.BOTH);
						break;
					case EndAction.MAXIMIZE:
						this._focusWindow?.maximize(Meta.MaximizeFlags.BOTH);
						break;
				}
				break;
			case PinchGestureType.CLOSE_DOCUMENT:
				this._keyboard.sendKeys([Clutter.KEY_Control_L, Clutter.KEY_w]);
		}
	}

	private _animatePreview(gestureCompleted: boolean, duration: number, callback?: () => void) {
		if (!gestureCompleted) {
			easeActor(this._preview, {
				x: this._windowFrame?.x,
				y: this._windowFrame?.y,
				width: this._windowFrame?.width,
				height: this._windowFrame?.height,
				scaleX: 1,
				scaleY: 1,
				opacity: 0,
				duration,
				mode: Clutter.AnimationMode.EASE_OUT_QUAD,
				onStopped: () => {
					if (callback)
						callback();
					this._gestureAnimationDone();
				},
			});
		} else {
			if (this._endAction === EndAction.CLOSE || this._endAction === EndAction.MINIMIZE) {
				easeActor(this._preview, {
					opacity: 255,
					scaleX: this._isAlredyMaximized && this._endAction === EndAction.MINIMIZE ? 0.8 : 0,
					scaleY: this._isAlredyMaximized && this._endAction === EndAction.MINIMIZE ? 0.8 : 0,
					duration,
					mode: Clutter.AnimationMode.EASE_OUT_QUAD,
					onStopped: () => {
						if (callback)
							callback();
						this._gestureAnimationDone();
					},
				});
			} else {
				easeActor(this._preview, {
					x: this._maximizedBox?.x,
					y: this._maximizedBox?.y,
					width: this._maximizedBox?.width,
					height: this._maximizedBox?.height,
					duration,
					mode: Clutter.AnimationMode.EASE_OUT_QUAD,
					onStopped: () => {
						if (callback)
							callback();
						this._gestureAnimationDone();
					},
				});
			}
		}
	}

	private _gestureAnimationDone() {
		this._preview.hide();
		this._preview.opacity = START_OPACITY;
		this._preview.set_scale(1, 1);
		this._preview.set_style('background-color: rgba(128, 174, 255, 0.5);');
	}
}