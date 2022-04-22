import Clutter from '@gi-types/clutter8';
import Shell from '@gi-types/shell0';
import {imports} from 'gnome-shell';
import {ExtSettings} from '../constants';
import {TouchpadSwipeGesture} from './swipeTracker';
import Gio from '@gi-types/gio2';
import VolumeControl = imports.ui.status.volume.VolumeControl;
import StreamSlider = imports.ui.status.volume.StreamSlider;
import VolumeSink = imports.ui.status.volume.VolumeSink;
const Main = imports.ui.main;
const Volume = imports.ui.status.volume;

export class VolumeUpDownGesture implements ISubExtension {
	private _connectHandlers: number[];
	private _touchpadSwipeTracker: typeof TouchpadSwipeGesture.prototype;
	private readonly _volumeControl: VolumeControl;
	private _maxVolume: number;
	private _volumeMenu: typeof Main.panel.statusArea.aggregateMenu._volume._volumeMenu;
	private _oldPercentage: number;
	private _streamSlider: StreamSlider;
	private _volumeSink: VolumeSink;
	private _sinkBinding: number;

	constructor() {
		this._volumeControl = Volume.getMixerControl();
		this._streamSlider = new Volume.StreamSlider(this._volumeControl);
		this._volumeSink = this._volumeControl.get_default_sink();
		this._connectHandlers = [];
		this._maxVolume = this._volumeControl.get_vol_max_norm() * this._streamSlider.getMaxLevel();
		this._volumeMenu = Main.panel.statusArea.aggregateMenu._volume._volumeMenu;
		this._oldPercentage = -1;

		this._touchpadSwipeTracker = new TouchpadSwipeGesture(
			(ExtSettings.DEFAULT_SESSION_WORKSPACE_GESTURE ? [3] : [4]),
			Shell.ActionMode.ALL,
			Clutter.Orientation.VERTICAL,
			false,
		);

		this._sinkBinding = 0;
	}

	_handle_sink_change(controller: VolumeControl, id: number) {
		this._volumeSink = controller.lookup_stream_id(id);
	}

	apply(): void {
		this._connectHandlers.push(this._touchpadSwipeTracker.connect('update', this._gestureBegin.bind(this)));
		this._connectHandlers.push(this._touchpadSwipeTracker.connect('update', this._gestureUpdate.bind(this)));
		this._connectHandlers.push(this._touchpadSwipeTracker.connect('update', this._gestureEnd.bind(this)));

		this._sinkBinding = this._volumeControl.connect(
			'default-sink-changed',
			(controller, id) => this._handle_sink_change(controller, id),
		);
	}

	destroy(): void {
		this._connectHandlers.forEach(handle => this._touchpadSwipeTracker.disconnect(handle));
		this._connectHandlers = [];
		this._touchpadSwipeTracker.destroy();

		this._volumeControl.disconnect(this._sinkBinding);
		this._sinkBinding = 0;
	}

	_gestureBegin(): void {
		this._maxVolume = this._volumeControl.get_vol_max_norm() * this._streamSlider.getMaxLevel();
	}

	_gestureUpdate(_gesture: never, _time: never, delta: number, distance: number): void {
		this._volumeSink.volume = Math.clamp(this._volumeSink.volume - Math.round((delta / distance) * this._maxVolume), 0, this._maxVolume);
	}

	_gestureEnd(): void {
		this._volumeSink.push_volume();
		this._showVolumeOsd(Math.round((this._volumeSink.volume / this._maxVolume) * 100));
	}

	_showVolumeOsd(currentPercentage: number): void {
		if (this._oldPercentage <= 0 || currentPercentage === 100 || this._oldPercentage !== currentPercentage) {
			const monitor = -1;
			const gicon = new Gio.ThemedIcon({name: this._volumeMenu.getIcon()});
			const label = this._volumeSink.get_port().human_port;
			Main.osdWindowManager.show(monitor, gicon, label, currentPercentage / 100);
			this._oldPercentage = currentPercentage;
		}
	}
}
