# Zoomy

**A Custom Element that does pinch-to-zoom, pan, and mouse-wheel zoom in/out**

**Demo**: https://ianbellomy.github.io/Zoomy/deploy/

**Use**:
```HTML
<script type="module" src="ZoomPanel.js"></script>
<zoom-panel style="touch-action:none">
	<!-- stuff you want to manipulate -->
</zoom-panel>
```

**Notes**: 
- Uses [PointerEvents](https://caniuse.com/#feat=pointer). 
- The contents are not constrained to the viewing area.
- Doesn't do tossing/flicking.
- If user leaves image zoomed out / scaled down, default behavior is to recenter and zoom to 1x.


**Warning**: 
- If children or parent elements of zoom-panel capture `pointerup` events, the gesture tracking can *break!* If you've got ways of making the pointerID caching/tracking more bullet proof, I'm all ears, but for now, I can't guarantee this thing will behave entirely independently of what you put in it or what you put it in. As such, I recommend finding some way to sneak in `zoomPanel.clearZoom()` where it make sense; this will clear the pointer cache an unstick a gesture that won't quit because a pointer up was swallowed somewhere. (I've run into a particular headache when polyfilled pointer events  don't properly pass up through a shadowdom leaving the zoom-panel still trying to track a pointerID that's never coming back. BARF!)

## Methods

`clearZoom()` 
Animate the content back to its default position and scale; reset the pointer tracking cache. I recommend providing some way for a user to trigger this. (See warning.)

`setZoom(targetScale:number,originX:number,originY:number,animate=false,center=false)`
Immediately set the zoom of the element. Calls to this while gesturing are ignored. 
- `targetScale` the scale to end up at
- `originX` where to zoom into
- `originY` where to zoom into
- `animate` should animate change? Default is `false`.
- `center` move the content so that the origin is in the middle of the zoom-panel element. Default is `false`.


## Events
Zoom-Panel emits the following custom events:

- `manipulationStart` when a pan or pinch starts while there was no gesture, e.g. putting a second finger down while panning triggers `pinchStart` but not `manipulationStart`.
- `panStart` 
- `panEnd`
- `pinchStart`
- `pinchEnd`
- `manipulationEnd` when some gesture ends without switching to a different gesture, e.g. putting a second finger down triggers `panEnd` but not `manipulationEnd`.
