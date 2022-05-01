// import GObject from '@gi-types/gobject2';
import Gio from '@gi-types/gio2';
import Clutter from '@gi-types/clutter';
import St from '@gi-types/st';

import { imports } from 'gnome-shell';
import { registerClass } from '../../common/utils/gobject';
import { easeActor } from '../utils/environment';

const ExtMe = imports.misc.extensionUtils.getCurrentExtension();
const Util = imports.misc.util;

declare type IconList = 'arrow1-right-symbolic.svg' | 'arrow1-left-symbolic.svg';

const Circle = registerClass(
	class GIE_Circle extends St.Widget {
		constructor(style_class: string) {
			style_class = `gie-circle ${style_class}`;
			super({ style_class });
			this.set_pivot_point(0.5, 0.5);
		}
	},
);

export const ArrowIconAnimation = registerClass(
	class GIE_ArrowIcon extends St.Widget {
		private readonly _inner_circle: typeof Circle.prototype;
		private readonly _outer_circle: typeof Circle.prototype;
		private readonly _arrow_icon: St.Icon;
		private _transition?: { opacity: { from: number, end: number }, inner_scale: { from: number; end: number }, translate: { from: number; end: number }, outer_scale: { from: number; end: number; } };

		constructor() {
			super();

			this._inner_circle = new Circle('gie-inner-circle');
			this._outer_circle = new Circle('gie-outer-circle');
			this._arrow_icon = new St.Icon({ style_class: 'gie-arrow-icon' });

			this._inner_circle.set_clip_to_allocation(true);
			this._inner_circle.add_child(this._arrow_icon);

			this.add_child(this._outer_circle);
			this.add_child(this._inner_circle);
		}

		gestureBegin(icon_name: IconList, from_left: boolean) {
			this._transition = {
				opacity: {
					from: 0,
					end: 255,
				},
				inner_scale: {
					from: 0,
					end: 1,
				},
				translate: {
					from: this._inner_circle.width * (from_left ? -1 : 1),
					end: 0,
				},
				outer_scale: {
					from: 0,
					end: 2,
				},
			};

			this._inner_circle.opacity = 0;
			this._arrow_icon.opacity = 0;
			this._outer_circle.opacity = 0;

			this._arrow_icon.set_style('color: #396bd7;');
			this._inner_circle.set_style('background-color: #ffffff;border-color: #ffffff;');

			this._inner_circle.translation_x = this._transition.translate.from;
			this._inner_circle.scale_x = this._transition.inner_scale.from;
			this._inner_circle.scale_y = this._transition.inner_scale.from;
			this._arrow_icon.translation_x = this._transition.translate.from;
			this._outer_circle.translation_x = this._transition.translate.from;
			this._outer_circle.scale_x = this._transition.outer_scale.from;
			this._outer_circle.scale_y = this._transition.outer_scale.from;
			this._arrow_icon.opacity = 255;
			this._arrow_icon.set_gicon(Gio.Icon.new_for_string(`${ExtMe.dir.get_uri()}/assets/${icon_name}`));
		}

		gestureUpdate(progress: number) {
			if (this._transition === undefined) return;

			if (progress > 0.9) {
				this._arrow_icon.set_style('color: #ffffff;');
				this._inner_circle.set_style('background-color: #396bd7;border-color: #396bd7;');
			} else {
				this._arrow_icon.set_style('color: #396bd7;');
				this._inner_circle.set_style('background-color: #ffffff;border-color: #ffffff;');
			}

			// if (progress > 0.9) {
			// 	const tempProgress = 10 * (progress - 0.9);
			// 	const color = [Util.lerp(255, 57, tempProgress), Util.lerp(255, 107, tempProgress), Util.lerp(255, 215, tempProgress)];
			// 	this._inner_circle.set_style(`border-color: rgb(${color.join(',')});background-color: rgb(${color.join(',')});`);
			// 	this._arrow_icon.set_style(`color: rgb(${Util.lerp(57, 255, tempProgress)}, ${Util.lerp(107, 255, tempProgress)}, ${Util.lerp(215, 255, tempProgress)});`);
			// }

			const currentOpacity = Util.lerp(this._transition.opacity.from, this._transition.opacity.end, progress);
			this._inner_circle.opacity = currentOpacity;
			this._arrow_icon.opacity = currentOpacity;
			this._outer_circle.opacity = currentOpacity;

			const currentInnerScale = Util.lerp(this._transition.inner_scale.from, this._transition.inner_scale.end, progress);
			this._inner_circle.scale_x = currentInnerScale;
			this._inner_circle.scale_y = currentInnerScale;

			const currentTranslate = Util.lerp(this._transition.translate.from, this._transition.translate.end, progress);
			this._inner_circle.translation_x = currentTranslate;
			this._arrow_icon.translation_x = currentTranslate;
			this._outer_circle.translation_x = currentTranslate;

			const currentOuterScale = Util.lerp(this._transition.outer_scale.from, this._transition.outer_scale.end, progress);
			this._outer_circle.scale_x = currentOuterScale;
			this._outer_circle.scale_y = currentOuterScale;
		}

		gestureEnd(duration: number, progress: number, callback: () => void) {
			if (this._transition === undefined) return;

			if (progress === 1) {
				this._arrow_icon.set_style('color: #ffffff;');
				this._inner_circle.set_style('background-color: #396bd7;border-color: #396bd7;');
			}

			const opacity = progress === 0 ? this._transition.opacity.from : this._transition.opacity.end;
			const translation_x = progress === 0 ? this._transition.translate.from : this._transition.translate.end;
			const scale_inner = progress === 0 ? this._transition.inner_scale.from : this._transition.inner_scale.end;
			easeActor(this._inner_circle, {
				opacity,
				translation_x,
				scale_x: scale_inner,
				scale_y: scale_inner,
				duration,
				mode: Clutter.AnimationMode.EASE_OUT_QUAD,
			});

			const tranlationOnStop = this._transition.translate.from;
			easeActor(this._arrow_icon, {
				opacity,
				duration,
				translation_x,
				mode: Clutter.AnimationMode.EASE_OUT_EXPO,
				onStopped: () => {
					callback();
					this._inner_circle.scale_x = 0;
					this._inner_circle.scale_y = 0;
					this._inner_circle.translation_x = tranlationOnStop;
					this._arrow_icon.translation_x = tranlationOnStop;
					this._arrow_icon.opacity = 0;
					this._outer_circle.scale_x = 0;
					this._outer_circle.scale_y = 0;
					this._outer_circle.translation_x = tranlationOnStop;
				},
			});

			const scale_outer = progress === 0 ? this._transition.outer_scale.from : this._transition.outer_scale.end;
			easeActor(this._outer_circle, {
				opacity,
				translation_x,
				scale_x: scale_outer,
				scale_y: scale_outer,
				duration,
				mode: Clutter.AnimationMode.EASE_OUT_EXPO,
			});
		}
	},
);