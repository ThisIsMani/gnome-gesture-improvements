import Clutter from '@gi-types/clutter';
import Shell from '@gi-types/shell';
import Meta from '@gi-types/meta';

import {global, imports} from 'gnome-shell';

import {getVirtualKeyboard, IVirtualKeyboard} from './utils/keyboard';
import {TouchpadSwipeGesture} from './swipeTracker';

const Main = imports.ui.main;
const Util = imports.misc.util;

const CLOSE_OPACITY = 0;
const snapPointThreshold = 0.2;

enum ACTION {'CLOSING', 'OPENING'}

export class DropDownTerminal implements ISubExtension {
	private _connectHandlers: number[];
	private _keyboard: IVirtualKeyboard;
	private _progress: number;
	private _touchpadSwipeTracker: typeof TouchpadSwipeGesture.prototype;
	private _focusWindow?: Meta.Window | null;
	private _actor: Clutter.Actor | null;
	private _currentAction: ACTION;

	constructor() {
		this._connectHandlers = [];
		this._keyboard = getVirtualKeyboard();
		this._actor = null;
		this._progress = 0;
		this._currentAction = ACTION.CLOSING;

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
		this._progress = 0;
		this._focusWindow = global.display.get_focus_window() as Meta.Window;
		let isTermOpen = this._focusWindow?.get_gtk_application_id() === 'com.github.amezin.ddterm';
		this._actor = isTermOpen ? this._focusWindow.get_compositor_private() : null;
		this._currentAction = isTermOpen ? ACTION.CLOSING : ACTION.OPENING;
		if (!isTermOpen) {
			this._toggleDDTerm();
			// eslint-disable-next-line @typescript-eslint/no-unused-vars
			global.display.connect('window-created', (d, metaWin) => {
				if (metaWin.get_gtk_application_id() === 'com.github.amezin.ddterm') {
					this._focusWindow = metaWin;
					this._actor = metaWin.get_compositor_private();
					isTermOpen = true;
				}
			});
		}
		this._actor?.set_pivot_point(0.5, 0);
		this._actor?.set_scale(1, isTermOpen ? 1 : 0);
		this._progress = isTermOpen ? 1 : 0;
		this._actor?.set_opacity(isTermOpen ? 255 : CLOSE_OPACITY);
	}

	_gestureUpdate(_gesture: never, _time: never, delta: number, distance: number): void {
		this._progress = Math.clamp(this._progress + (delta / distance), 0, 1);
		this._actor?.set_scale(1, this._progress);
		this._actor?.set_opacity(Util.lerp(CLOSE_OPACITY, 255, this._progress));
	}

	_gestureEnd(): void {
		if (((this._currentAction === ACTION.OPENING) && (this._progress > snapPointThreshold)) || ((this._currentAction === ACTION.CLOSING) && (this._progress < 1 - snapPointThreshold))) {
			this._animateActor(true, (this._currentAction === ACTION.CLOSING), 400);
		} else {
			this._animateActor(false, (this._currentAction === ACTION.OPENING), 100);
		}
	}

	private _toggleDDTerm() {
		this._keyboard.sendKeys([Clutter.KEY_F12]);
	}

	private _animateActor(gestureCompleted: boolean, toggle: boolean, duration: number) {
		const config =
			{
				'opacity': {
					from: this._actor?.opacity,
					to: (this._currentAction === ACTION.OPENING) === gestureCompleted ? 255 : CLOSE_OPACITY,
				},
				'scale-y': {
					from: this._actor?.scale_y,
					to: (this._currentAction === ACTION.OPENING) === gestureCompleted ? 1 : 0,
				},
			};
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

			const connectionID = this._actor.connect('transitions-completed', () => {
				if (toggle) {
					this._toggleDDTerm();
				}
				this._actor?.disconnect(connectionID);
				this._actor = null;
			});
		}
	}

	destroy(): void {
		this._connectHandlers.forEach(handle => this._touchpadSwipeTracker.disconnect(handle));
		this._touchpadSwipeTracker.destroy();
		this._connectHandlers = [];
	}
}