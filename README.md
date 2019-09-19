# Zoomy

**A Custom Element that does pinch-to-zoom, pan, and mouse-wheel zoom in/out**

**Demo**: https://ianbellomy.github.io/Zoomy/deploy/

**Notes**: 
- Uses [PointerEvents](https://caniuse.com/#feat=pointer). 
- The contents are not constrained to the viewing area.
- Doesn't do tossing/flicking.
- If user leaves image zoomed out / scaled down, default behavior is to recenter and zoom to 1x.


**Use**
```HTML
<script type="module" src="ZoomPanel.js"></script>
<zoom-panel style="touch-action:none">
	<!-- stuff you want to manipulate --!>
</zoom-panel>
```

**Warning**: 
- If children or parent elements of zoom-panel capture `pointerup` events, the gesture tracking can *break*! If you've got ways of making the pointerID caching/tracking more bullet proof, I'm all ears, but for now, I can't guarantee this thing will act independently of what you put in it or what you put it in. *Sad*.

## Events
Zoom-Panel emits the following custom events:

- `manipulationStart` when a pan or pinch starts while there was no gesture, e.g. putting a second finger down while panning triggers `pinchStart` but not `manipulationStart`.
- `panStart` 
- `panEnd`
- `pinchStart`
- `pinchEnd`
- `manipulationEnd` when some gesture ends without switching to a different gesture, e.g. putting a second finger down triggers `panEnd` but not `manipulationEnd`.
