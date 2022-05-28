import Clutter from '@gi-types/clutter';
import Meta from '@gi-types/meta';
import Shell from '@gi-types/shell';

import {global, imports} from 'gnome-shell';

import {PinchGestureType} from '../../common/settings';
import {TouchpadPinchGesture} from '../trackers/pinchTracker';
import {getVirtualKeyboard, IVirtualKeyboard} from '../utils/keyboard';

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
	// private _preview: St.Widget;
	private _focusWindow?: Meta.Window | null;
	private _maximizedBox: Meta.Rectangle;
	private _endAction: EndAction;
	private _isAlreadyMaximized: boolean;
	private _actor: Clutter.Actor | null;
	private _originalSize: { x: number; y: number, width: number, height: number };
	private _windowClosed = false;

	constructor(nfingers: number[], closeType: PinchGestureType.CLOSE_DOCUMENT | PinchGestureType.CLOSE_WINDOW) {
		this._closeType = closeType;
		this._keyboard = getVirtualKeyboard();
		this._endAction = EndAction.CLOSE;
		this._isAlreadyMaximized = false;
		this._maximizedBox = new Meta.Rectangle();
		this._actor = null;
		this._originalSize = {
			x: 0,
			y: 0,
			width: 0,
			height: 0,
		};

		this._pinchTracker = new TouchpadPinchGesture({
			nfingers: nfingers,
			allowedModes: Shell.ActionMode.NORMAL,
			pinchSpeed: 0.25,
		});
		this._pinchTracker.connect('begin', this.gestureBegin.bind(this));
		this._pinchTracker.connect('update', this.gestureUpdate.bind(this));
		this._pinchTracker.connect('end', this.gestureEnd.bind(this));
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

	gestureBegin(tracker: Type_TouchpadPinchGesture) {
		this._windowClosed = false;
		this._focusWindow = global.display.get_focus_window() as Meta.Window | null;
		if (!this._focusWindow) return;

		this._actor = this._focusWindow.get_compositor_private();
		this._actor?.set_pivot_point(0.5, 0.5);
		this._originalSize = {
			x: this._focusWindow?.get_frame_rect().x ?? 0,
			y: this._focusWindow?.get_frame_rect().y ?? 0,
			width: this._focusWindow?.get_frame_rect().width ?? 0,
			height: this._focusWindow?.get_frame_rect().height ?? 0,
		};
		this._actor?.map();
		this._maximizedBox = this.getMaximizedBox(this._focusWindow);
		this._isAlreadyMaximized = this._focusWindow?.get_maximized() === Meta.MaximizeFlags.BOTH;
		this._actor?.set_width(this._originalSize.width);

		tracker.confirmPinch(0, [CloseWindowGestureState.PINCH_IN, CloseWindowGestureState.DEFAULT, CloseWindowGestureState.PINCH_OUT], CloseWindowGestureState.DEFAULT);

	}

	gestureUpdate(_tracker: unknown, progress: number): void {
		progress = progress - CloseWindowGestureState.PINCH_IN;
		if (progress <= 1 && this._actor) {
			progress *= progress * progress;
			this._endAction = this._isAlreadyMaximized && progress >= 0.8 ? EndAction.MINIMIZE : EndAction.CLOSE;
			this._actor.set_scale(progress, progress);
			this._actor.opacity = Util.lerp(START_OPACITY, 255, progress);
		} else if (!this._isAlreadyMaximized && this._actor !== null) {
			this._actor.opacity = 255;
			// this._actor.set_scale(progress * progress, progress);
			// log(this._maximizedBox.width + '  ' + this._originalSize.width);
			this._actor.set({
				x: Util.lerp(this._originalSize.x, this._maximizedBox.x, progress - 1),
				y: Util.lerp(this._originalSize.y, this._maximizedBox.y, progress - 1),
				width: Util.lerp(this._originalSize.width, this._maximizedBox.width, progress - 1),
				height: Util.lerp(this._originalSize.height, this._maximizedBox.height, progress - 1),
			});
			// log(this._actor.height + '  ' + this._actor.width);
			// this._actor.set_scale(progress, progress);
		}
	}

	gestureEnd(_tracker: unknown, duration: number, progress: CloseWindowGestureState) {
		switch (progress) {
			case CloseWindowGestureState.DEFAULT:
				this._animateActor(false, false, duration);
				break;
			case CloseWindowGestureState.PINCH_IN:
				this._animateActor(true, true, duration);
				break;
			case CloseWindowGestureState.PINCH_OUT:
				this._endAction = EndAction.MAXIMIZE;
				this._animateActor(true, true, duration);
				break;
		}
	}

	private _invokeGestureCompleteAction() {
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
	}

	private _animateActor(gestureCompleted: boolean, invokeCompleteGesture: boolean, duration: number) {
		let config: {
			'x'?: { from: number | undefined, to: number },
			'y'?: { from: number | undefined, to: number },
			'scale-x'?: { from: number | undefined, to: number },
			'scale-y'?: { from: number | undefined, to: number },
			'opacity'?: { from: number | undefined, to: number },
			'width'?: { from: number | undefined, to: number },
			'height'?: { from: number | undefined, to: number },
		};
		const startAnimation = () => {
			if (this._actor) {
				for (const [key, value] of Object.entries(config)) {
					let transition = this._actor.get_transition(key);
					if (!transition) {
						this._actor.set_property(key, 0);
						this._actor.save_easing_state();
						this._actor.set_easing_duration(1000);
						this._actor.set_property(key, 1);
						this._actor.restore_easing_state();

						transition = this._actor.get_transition(key);
					}
					if (transition) {
						transition.set_duration(duration);
						transition.set_from(value.from);
						transition.set_to(value.to);
						transition.set_progress_mode(Clutter.AnimationMode.EASE_OUT_QUAD);
					}
				}
			}
		};
		if (!gestureCompleted) {
			config = {
				'x': {
					from: this._actor?.x,
					to: this._originalSize.x,
				},
				'y': {
					from: this._actor?.y,
					to: this._originalSize.y,
				},
				'width': {
					from: this._actor?.width,
					to: this._originalSize.width,
				},
				'height': {
					from: this._actor?.height,
					to: this._originalSize.height,
				},
				'opacity': {
					from: this._actor?.opacity,
					to: 255,
				},
				'scale-x': {
					from: this._actor?.scale_x,
					to: 1,
				},
				'scale-y': {
					from: this._actor?.scale_y,
					to: 1,
				},
			};
			startAnimation();
		} else {
			switch (this._endAction) {
				case EndAction.CLOSE:
					if (invokeCompleteGesture) {
						this._invokeGestureCompleteAction();
					}
					// eslint-disable-next-line @typescript-eslint/no-unused-vars,no-case-declarations
					const destroyConnection = global.window_manager.connect('destroy', (wm, actor) => {
						const isSameWindow = actor.get_meta_window().get_id() === this._focusWindow?.get_id();
						config = {
							'opacity': {
								from: this._actor?.opacity,
								to: isSameWindow ? 0 : 255,
							},
							'scale-x': {
								from: this._actor?.scale_x,
								to: isSameWindow ? 0 : 1,
							},
							'scale-y': {
								from: this._actor?.scale_y,
								to: isSameWindow ? 0 : 1,
							},
						};
						startAnimation();
						global.window_manager.disconnect(destroyConnection);
					});
					break;
				case EndAction.MINIMIZE:
					config = {
						'opacity': {
							from: this._actor?.opacity,
							to: 255,
						},
						'scale-x': {
							from: this._actor?.scale_x,
							to: this._isAlreadyMaximized ? 0.8 : 0,
						},
						'scale-y': {
							from: this._actor?.scale_y,
							to: this._isAlreadyMaximized ? 0.8 : 0,
						},
					};
					startAnimation();
					break;
				case EndAction.MAXIMIZE:
					config = {
						'x': {
							from: this._actor?.x,
							to: this._maximizedBox?.x,
						},
						'y': {
							from: this._actor?.y,
							to: this._maximizedBox?.y,
						},
						'width': {
							from: this._actor?.width,
							to: this._maximizedBox?.width,
						},
						'height': {
							from: this._actor?.height,
							to: this._maximizedBox?.height,
						},
					};
					startAnimation();
					break;
			}
		}
		if (this._actor) {
			const connectionID = this._actor.connect_after('transitions-completed', () => {
				if (this._endAction !== EndAction.CLOSE && invokeCompleteGesture) {
					this._invokeGestureCompleteAction();
				}
				this._actor?.disconnect(connectionID);
				this._actor = null;
			});
		}
	}

	destroy(): void {
		this._pinchTracker.destroy();
		// this._preview.destroy();
		this._actor?.destroy();
	}
}