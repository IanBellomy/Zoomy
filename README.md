# Zoomy

**A Custom Element that does pinch-to-zoom, pan, and mouse-wheel zoom in/out**

**Demo**: https://ianbellomy.github.io/Zoomy/deploy/

**Notes**: 
- Uses [PointerEvents](https://caniuse.com/#feat=pointer). 
- The contents are not constrained to the viewing area.
- Doesn't do tossing/flicking.
- If user leaves image zoomed out / scaled down, default behavior is to recenter and zoom to 1x.


**Warning**: 
- If children or parent elements of zoom-panel capture pointerup events, the gesture tracking can *break*. If you've got ways of making the pointerID caching/tracking more bullet proof, I'm all ears.