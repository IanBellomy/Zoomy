interface Point{
    x:number,
    y:number
}

interface Rect{
    top:number,
    left:number,
    width:number,
    height:number,
    /** @deprecated */
    x?:number,
    /** @deprecated */
    y?:number
}

const defaultEase = "cubic-bezier(0.375, 0.115, 0.000, 1.000);"
/**
 * In seconds
 */
const defaultEaseTime = 0.65

/**
 * An element that users can pinch-to-zoom and pan.
 */
class ZoomPanel extends HTMLElement{

    /**
     * If false, a touch-pointer-down event that bubbles up will be treated as the start of a pan gesture.
     * If true, two fingers must be used to initiate a pan gesture.
     */
    panRequiresTwoFingers = true;

    /**
     * If true, a cursor-pointer-down event that bubbles up will be treated as the start of a pan gesture.
     */
    panWithMouse = true;

    /**
     * If true, a stylus-pointer-down event that bubbles up will be treated as the start of a pan gesture.
     */
    panWithPen = false;

    /** A cache of pointerEvents active on this element; alternative to touchEvent.touches  */
    private pointers:PointerEvent[] = []
    /** What kind of gesture is the user performing, if any */
    private mode:"none"|"pinch"|"pan"|"doubletap"|"scroll" = "none"

    /** The target scale of the zoom-panel.  */
    private _scale = 1
    get scale(){
        return this._scale;
    }

    /** The target translation the zoom panel.  */
    private _translation = {x:0,y:0}
    /** The target translation the zoom panel.  */
    get translation(){
        return this._translation;
    }

    _cachedComputedStyle:CSSStyleDeclaration = null
    get computedStyle(){
        if(this._cachedComputedStyle == null){
            this._cachedComputedStyle = window.getComputedStyle(this);
        }
        // schedule cache clean
        window.requestAnimationFrame(()=>{
            this._cachedComputedStyle = null;
        })
        return window.getComputedStyle(this);
    }

    _cachedCurrentTransform:{
        x:number,
        y:number,
        scale:number
    } = null;

    // TODO: Watch out for safari issue transform issue!!!
    // TODO: improve caching -- don't cacheBust when not animating.
    /** The current transform even during transitions. */
    get currentTransform(){
        if(this._cachedCurrentTransform == null){
            let matrix = new WebKitCSSMatrix(this.computedStyle.transform);
            this._cachedCurrentTransform = {
                x:matrix.e,
                y:matrix.f,
                scale:matrix.a
            }
        }
        // schedule cache clean
        window.requestAnimationFrame(()=>{
            this._cachedCurrentTransform = null;
        })

        return this._cachedCurrentTransform;
    }

    /** The target transform matrix */
    get matrix(){
        return new DOMMatrix(
        ).translateSelf(
            this.translation.x,
            this.translation.y,
            0
        ).scaleSelf(
            this.scale,
            this.scale
        )
    }

    /**
     * Get missing transformation
     */
    get svgMatrix(){
        // NOTE: SVGMatrix (SVG1.1) is NOT analogous to DOMMatrix!
        let m = document.createElementNS("http://www.w3.org/2000/svg", "svg").createSVGMatrix() as SVGMatrix;
        // m = m.translate(
        //     this.translation.x,
        //     this.translation.y,
        //     0
        // )
        m = m.scale(
            this.scale,
            this.scale
        );
        return m;
    }

    /** The absolute origin from which the absolute scale is. Set using doPinch(...) */
    private origin:Point = {x:0,y:0}
    /** The initial center of a pinch or pan when it begins */
    private initialCenter:Point = {x:0,y:0}
    /** The initial distance of a pinch when it begins */
    private initialDistance = 0
    /** The initial scale of the zoom panel when a pinch or pan begins */
    private initialScale = 1
    /** The initial transformation offset of the zoom panel when a pinch or pan begins */
    private initialGesturePosition:Point = {x:0,y:0}
    /** The current distance of a pinch during a pinch gesture while it is underway */
    private pinchDistance = undefined
    /** The the position of the current center point during a gesture  relative to the initial point */
    private gesturePositionChange:Point = {x:0,y:0}
    /** The current scale change of a pinch gesture while the gesture is underway. This always starts at 1 when a pinch begins. */
    private pinchScale = undefined
    /** The zoom-panel element's bounding box. */
    private _cachedBoundingBox:{width:number,height:number,top:number,left:number} = null

    /** time (ms) of last pointerDown */
    private lastPointTime = undefined
    /** location of last pointerDown */
    private lastPointPos:Point = {x:0,y:0}
    /** Maximum time that can pass between taps for two taps to count as a double tap */
    private doubleTapTime = 300
    public centerOnDoubleTap = false
    /** Used for the mouseWheelTimeout complete */
    private mouseWheelTimeoutID = undefined

    /** clearZoom uses a delay to dispatch a zoomClear event */
    private clearZoomTimeoutID = undefined

    private _manipulationAllowed = true;

    /** Do touches trigger pan/zoom; if set to false, will cancel any ongoing manipulations */
    get manipulationAllowed(){ return this._manipulationAllowed}
    set manipulationAllowed(val){
        this._manipulationAllowed = val;
        if(!val){
            this.pointers.length = 0;
            if(this.gesturing){
                switch(this.mode){
                    case "pinch":
                        this.pinchEnd()
                        this.dispatchEvent(new CustomEvent("pinchEnd")); break;
                    case "pan":
                        this.panEnd();
                        this.dispatchEvent(new CustomEvent("panEnd")); break;
                }
                this.gestureEnd()
                this.dispatchEvent(new CustomEvent("manipulationEnd"))
            }
        }
    }

    /** Whether or not a user is pinching or panning */
    get gesturing(){
        return this.mode != "none"
    }

    /**
     * The bounding client box rect transformations.
     * */
    get untransformedBoundingClientRect(){
        if(this._cachedBoundingBox == null){
            this._cachedBoundingBox = this.getBoundingClientRect()
        }
        return this._cachedBoundingBox
    }

     /**
     * clear the cached bounding client rect
     */
    private _flushCachedBoundingRect(){
        let tempTransformSave = this.style.transform;
        let tempTransition = this.style.transition;
        this.style.transition = "none";
        this.style.transform = "";
        this._cachedBoundingBox = this.getBoundingClientRect()
        this.style.transform = tempTransformSave;
        let _ = this.offsetWidth; // !! force redraw to avoid a subsequent transition value from triggering a transition back to the original scale. !@#!
        this.style.transition = tempTransition
        return this._cachedBoundingBox
    }

    private _handleResize(){
        let previousVP = this.viewport;
        this._flushCachedBoundingRect();
        this.frame(previousVP,false);
    }

    private setTransform(x:number,y:number,scale:number){
        // There may be an issue in webkit transition that can lead to a flash of no visuals...
        // Not sure what it is exactly, but rounding target values seems to help...
        let roundFactor = 1000;
        x = Math.floor(x*roundFactor)/roundFactor;
        y = Math.floor(y*roundFactor)/roundFactor;
        scale = Math.floor(scale*roundFactor)/roundFactor;
        this.style.transform = `translate(${x}px, ${y}px) scale(${scale})`

        // cache
        this._translation.x = x
        this._translation.y = y
        this._scale         = scale;
    }

    constructor(){
        super()
        this._handleResize = this._handleResize.bind(this)
        this._flushCachedBoundingRect = this._flushCachedBoundingRect.bind(this)
        this.handlePointerUp = this.handlePointerUp.bind(this)
    }

    resizeObserver:ResizeObserver|null =
        ResizeObserver ?
            new ResizeObserver((e)=>{
                console.log(e)
                this._handleResize();
            })
            : null

    connectedCallback(){
        this.style.transformOrigin = `0 0`

        // when the browser window resizes, we will resize, and we need to then recalculate the bounding box
        this.resizeObserver?.observe(this)
        if(!this.resizeObserver){
            window.addEventListener("resize",this._handleResize)
        }

        // Add basic event listeners that determine pan/pinch start/move/end and capture events as needed.
        this.addEventListener("pointerdown",(e)=>{
            if(!this.manipulationAllowed) return;
            // update cached pointers
            this.pointers.push(e)

            // console.log("zoom pointerdown",this.pointers.length,e)

            if(this.pointers.length == 2 && this.mode=="none"){
                // managed to put down two fingers at the "same" time, e.g. between event-loop ticks.
                this.gestureWillBegin()
                this.pinchStart(e)
                this.dispatchEvent(new CustomEvent("pinchStart"))
                this.dispatchEvent(new CustomEvent("manipulationStart"))
            }else if(this.pointers.length == 2 && this.mode=="pan"){
                // Added a finger during a pan gesture. [Can happen if we were pinching, then lifted, then placed another finger]
                this.panEnd(e)
                this.dispatchEvent(new CustomEvent("panEnd"))
                this.pinchStart(e)
                this.dispatchEvent(new CustomEvent("pinchStart"))
            }else if(this.pointers.length == 1 && this.mode == "none"){
                let currentTime = new Date().getTime();
                // console.log("Double? ",(currentTime - this.lastPointTime))
                if(this.lastPointTime && (currentTime - this.lastPointTime) < this.doubleTapTime ){
                    // clear pointer cache
                    this.pointers.length = 0
                    this.gestureWillBegin()
                    // add the pointer back in
                    this.pointers.push(e)
                    e.stopImmediatePropagation()
                    e.preventDefault()
                    this.doubleTap(e)
                }else{
                    this.lastPointTime = currentTime
                    this.lastPointPos.x = this.pointers[0].clientX
                    this.lastPointPos.y = this.pointers[0].clientY
                }
            }


         // check for double-tap-to-clear
            // let currentTime = new Date().getTime();
            //     // is the tap soon after a previous tap?
            //     if(this.lastPointTime && (currentTime - this.lastPointTime) < this.doubleTapTime ){
            //         // is the tap

            //         // clear pointer cache
            //         this.pointers.length = 0
            //         this.pointers.push(e)
            //         e.stopImmediatePropagation()
            //         e.preventDefault()
            //         this.doubleTap(e)
            //     }else{
            //         this.lastPointTime = currentTime
            //         this.lastPointPos.x = this.pointers[0].clientX
            //         this.lastPointPos.y = this.pointers[0].clientY
            //     }
            // }

            if(this.gesturing){
                e.preventDefault()
                e.stopImmediatePropagation()
            }

            if(this.pointers.length == 10){
                if(
                    !!this._debugElement &&
                    confirm("Enable Zoom-panel debug mode?")
                ){
                    this.debug();
                }
            }

        },{capture:true})

        // BUBBLE listener
        // if a pointerdown event bubbles up into the zoom panel, un-captured, then the user may want to pan...
        this.addEventListener("pointerdown",(e:PointerEvent)=>{

            if(!this.manipulationAllowed) return;

            // ignore input if flags say so
            if( (e.pointerType == "touch" && this.panRequiresTwoFingers) ||
                (e.pointerType == "mouse" && !this.panWithMouse) ||
                (e.pointerType == "pen" && !this.panWithPen)) return;


            if(!this.gesturing && this.pointers.length == 1){
                // console.log("ZoomPanel:: un-captured pointerdown bubbling while zoomed, assuming pan is desired...",e)
                e.stopImmediatePropagation();
                this.gestureWillBegin()
                this.panStart(e)
                this.dispatchEvent(new CustomEvent("panStart"))
                this.dispatchEvent(new CustomEvent("manipulationStart")) // TODO: Undo previous tap action?
                // from this point, zoom panel will capture pointer events going downhill and call panMove()
            }
        })

        this.addEventListener("pointermove",(e)=>{
            if(!this.manipulationAllowed) return;
            // console.log("zoom pointermove ",this.pointers)
            // update cached pointers
            for(let i = 0; i < this.pointers.length; i++){
				if(this.pointers[i].pointerId == e.pointerId) this.pointers[i] = e
			}

            if(this.pointers.length >= 2 && this.mode=="none"){
                // two fingers came out of nowhere!
                this.gestureWillBegin()
                this.pinchStart(e)
                this.dispatchEvent(new CustomEvent("pinchStart"))
                this.dispatchEvent(new CustomEvent("manipulationStart"))
            } else if(this.pointers.length >= 2 && this.mode =="pinch"){
                this.pinchMove(e)
            } else if(this.pointers.length >= 2 && this.mode == "pan"){
                // finger came out of nowhere!
                this.pinchEnd(e)
                this.dispatchEvent(new CustomEvent("pinchEnd"))
                this.panStart(e)
                this.dispatchEvent(new CustomEvent("panStart"))
            }else if(this.pointers.length == 1 && this.mode == "pan"){
                // this.dispatchEvent(new CustomEvent("manipulationStart"))         // ?!
                this.panMove(e)
            }

            if(this.gesturing){
                e.preventDefault()
                e.stopImmediatePropagation()
            }
        },{capture:true})


        // Listen during capture on document to prevent elements from swallowing this event and leaving our cache borked.
        // Should there be a global cache manager?
        document.addEventListener("pointerup",this.handlePointerUp,{capture:true})
        document.addEventListener("pointercancel",this.handlePointerUp,{capture:true})

        // context menu event swallows pointer event :(
        document.addEventListener("contextmenu",this.handlePointerUp,{capture:true})

        // this.addEventListener("pointerout",handlePointerUp,{capture:true})        // should handle these?...  nope — can drag gesture out of zoom area. what
        // this.addEventListener("pointerleave",handlePointerUp,{capture:true})
        // document.addEventListener("pointercancel",handlePointerUp,{capture:true})

        // this.addEventListener("pointerup",(e)=>{
        //     if(this.gesturing) e.stopImmediatePropagation();
        // },{capture:true})

        // this.addEventListener("pointercancel",this.pinchEnd.bind(this),{capture:true})

        this.addEventListener("wheel",this.handleMouseWheel.bind(this),{capture:true})

        document.addEventListener("visibilitychange", this.handleMainWindowVisibilityChange.bind(this), {capture:true});
    }

    handleMainWindowVisibilityChange(e:Event){
        this.clearManipulation();
    }

    disconnectedCallback(){
        this.resizeObserver?.unobserve(this)
        if(!this.resizeObserver){
            window.removeEventListener("resize",this._handleResize)
        }
        document.removeEventListener("pointerup",this.handlePointerUp,{capture:true})
    }

    handlePointerUp(e:PointerEvent){
        // update cached pointers
        let removedPointerEvent = null
        for(let i = 0; i < this.pointers.length; i++){
            if(this.pointers[i].pointerId == e.pointerId) removedPointerEvent = this.pointers.splice(i,1)[0]
        }

        if(removedPointerEvent === null){
            console.warn("pointer up handled but did not find its pointerId in tracked pointers!")
        }

        if(!this.manipulationAllowed){
            // If manipulationAllowed == false, then the pointers list should've been cleared when set to false and no pointers events should be added ever.
            // And yet...
            if(removedPointerEvent){
                console.warn("pointer up handled and found pointer to remove but it shot not have been there because manipulationAllowed was false!")
            }
            return;
        }

        if(e.type == "contextmenu"){
            // don't prevent default or capture!
            return;
        }

        // console.log("zoom pointerup",this.pointers.length,e)

        if(this.pointers.length == 0 && this.mode=="pinch"){
            // Removed multiple fingers at the "same time".
            e.preventDefault()
            e.stopImmediatePropagation()
            this.pinchEnd(e)
            this.dispatchEvent(new CustomEvent("pinchEnd"))
            this.gestureEnd(e)
            this.dispatchEvent(new CustomEvent("manipulationEnd"))
        } else if(this.pointers.length == 0 && this.mode=="pan"){
            // Removed the last finger while panning, e.g. when there was only one finger to remove
            e.preventDefault()
            e.stopImmediatePropagation()
            this.panEnd(e)
            this.dispatchEvent(new CustomEvent("panEnd"))
            this.gestureEnd(e)
            this.dispatchEvent(new CustomEvent("manipulationEnd"))
        }else if(this.pointers.length == 1 && this.mode == "pinch"){
            // Removed all but one finger during a pinch gesture.
            e.preventDefault()
            e.stopImmediatePropagation()
            this.pinchEnd(e)
            this.dispatchEvent(new CustomEvent("pinchEnd"))
            this.panStart(this.pointers[0]) // the remaining pointer
            this.dispatchEvent(new CustomEvent("panStart"))
        }

        // TODO: Consider: If the gesture is done, should we allow the event to continue down into children?
    }

    private handleMouseWheel(e:WheelEvent){
        if(!this.manipulationAllowed) return;
        this.mode = "scroll";
        let targetScale = this._scale - e.deltaY/750
        this.style.willChange = "transform"
        this.style.transition = ""
        this.doPinch(targetScale, e.clientX - this.untransformedBoundingClientRect.left, e.clientY - this.untransformedBoundingClientRect.top)

        if(this.mouseWheelTimeoutID) clearTimeout(this.mouseWheelTimeoutID)
        else this.dispatchEvent(new CustomEvent("manipulationStart"))

        this.mouseWheelTimeoutID = setTimeout(()=>{
            this.mouseWheelTimeoutID = undefined
            this.gestureEnd()
        },750)
    }

    private doubleTap(e:PointerEvent){
        // console.log("doubletap")
        if(this._scale > 1) this.clearZoom()
        else{
            let x = e.clientX
            let y = e.clientY
            this.doPinch(2,x - this.untransformedBoundingClientRect.left, y - this.untransformedBoundingClientRect.top,true,this.centerOnDoubleTap)
        }

    }

    /**
     * Called when a a second  point is detected (during pointer-start or pointermove)
     */
    private pinchStart(e:PointerEvent){
        if(this.gesturing) return
        else this.mode = "pinch"

        // recache bounding box?...

        // console.log("pinch start",e)
        this.style.transition = "none"
        // this.style.willChange = "transform"

        this.initialCenter.x = (this.pointers[1].clientX + this.pointers[0].clientX)/2 - this.untransformedBoundingClientRect.left
        this.initialCenter.y = (this.pointers[1].clientY + this.pointers[0].clientY)/2 - this.untransformedBoundingClientRect.top

        let distanceX = (this.pointers[1].clientX - this.pointers[0].clientX)
        let distanceY = (this.pointers[1].clientY - this.pointers[0].clientY)
        this.initialDistance = Math.sqrt(distanceX*distanceX+distanceY*distanceY)

        // as-if moved in case pinchEnd is called directly afterwards.
        this.pinchScale = 1
        this.gesturePositionChange.x = 0
        this.gesturePositionChange.y = 0
        this.pinchDistance = this.initialDistance
    }

    /**
     * Called when a pointermove happens with two pointers.
     * Always called after pinchStart().
     */
    private pinchMove(e:PointerEvent){

        let distanceX = (this.pointers[1].clientX - this.pointers[0].clientX)
        let distanceY = (this.pointers[1].clientY - this.pointers[0].clientY)

        this.pinchDistance = Math.sqrt(distanceX*distanceX+distanceY*distanceY)
        this.pinchScale    = (this.pinchDistance / this.initialDistance)

        let newCenterX = (this.pointers[1].clientX + this.pointers[0].clientX)/2 - this.untransformedBoundingClientRect.left
        let newCenterY = (this.pointers[1].clientY + this.pointers[0].clientY)/2 - this.untransformedBoundingClientRect.top

        this.gesturePositionChange.x =  newCenterX - this.initialCenter.x * this.pinchScale
        this.gesturePositionChange.y =  newCenterY - this.initialCenter.y * this.pinchScale

        let absoluteScale       = this.pinchScale * this.initialScale
        let absoluteOffsetX     = this.gesturePositionChange.x + this.initialGesturePosition.x * this.pinchScale
        let absoluteOffsetY     = this.gesturePositionChange.y + this.initialGesturePosition.y * this.pinchScale


        // do transform
        this.setTransform(absoluteOffsetX,absoluteOffsetY,absoluteScale);

        // cache values
        this.origin.x = newCenterX;
        this.origin.y = newCenterY;

    }

    /**
     * Called when a user lifts a finger while pinching, after pinchEnd().
     * TODO: Call if nothing inside captures a pointer event...
     */
    private panStart(e:PointerEvent){
        if(this.gesturing) return
        else this.mode = "pan"

        // console.log("pan start",e)
        this.style.transition = "none"
        // Fixme: If we triple click, the double tap will activate a transition, and the third will start a pan, mid transition, snapping the zoom to the final size.
        // It looks/feels gross. We might either check for triple tap, or set the transform to whatever it is mid transform.

        let x = e.clientX
        let y = e.clientY

        this.initialCenter.x = x - this.untransformedBoundingClientRect.left
        this.initialCenter.y = y - this.untransformedBoundingClientRect.top

        // as-if moved in case panEnd is called directly afterwards.
        // as-if moved in case pinchEnd is called directly afterwards.
        this.pinchScale = 1
        this.gesturePositionChange.x = 0
        this.gesturePositionChange.y = 0
        this.pinchDistance = this.initialDistance
    }

    /**
     * Called when moving one finger after panStart()
     */
    private panMove(e:PointerEvent){
        // console.log("pan move ",e)

        // issue transitioning from two point to one point move...
        // need to preserve the scale of the two point move.
        this.pinchScale    = 1

        let x = e.clientX
        let y = e.clientY

        let newCenterX = x - this.untransformedBoundingClientRect.left
        let newCenterY = y - this.untransformedBoundingClientRect.top

        this.gesturePositionChange.x =  newCenterX - this.initialCenter.x * this.pinchScale
        this.gesturePositionChange.y =  newCenterY - this.initialCenter.y * this.pinchScale

        let absoluteScale       = this.pinchScale * this.initialScale
        let absoluteOffsetX     = this.gesturePositionChange.x + this.initialGesturePosition.x * this.pinchScale
        let absoluteOffsetY     = this.gesturePositionChange.y + this.initialGesturePosition.y * this.pinchScale

        // do transform
        this.setTransform(absoluteOffsetX,absoluteOffsetY,absoluteScale);

        // cache values
        this.origin.x = newCenterX;
        this.origin.y = newCenterY;
    }

    private panEnd(e?:PointerEvent){
        if(!this.gesturing) return
        else this.mode = "none"
        // console.log("pan end ",e)
        // pretty sure this doesn't need to be exactly the same as pinchEnd. But to be safe...
        this.initialCenter.x = undefined
        this.initialCenter.y = undefined
        this.initialScale    *= this.pinchScale // hmm....
        this.initialGesturePosition.x  = this.initialGesturePosition.x * this.pinchScale + this.gesturePositionChange.x
        this.initialGesturePosition.y  = this.initialGesturePosition.y * this.pinchScale + this.gesturePositionChange.y
        this.pinchDistance = undefined
        this.gesturePositionChange = {x:0,y:0}
        this.pinchScale = undefined
    }

    private pinchEnd(e?:PointerEvent){
        if(!this.gesturing) return
        else this.mode = "none"
        // console.log("pinch end ",e)
        this.initialCenter.x = undefined
        this.initialCenter.y = undefined
        this.initialScale    *= this.pinchScale
        this.initialGesturePosition.x  = this.initialGesturePosition.x * this.pinchScale + this.gesturePositionChange.x
        this.initialGesturePosition.y  = this.initialGesturePosition.y * this.pinchScale + this.gesturePositionChange.y
        this.pinchDistance = undefined
        this.gesturePositionChange = {x:0,y:0}
        this.pinchScale = undefined
    }

    /** Called before a pan or pinch begins while not doing either */
    private gestureWillBegin(e?:PointerEvent){
        if(this.clearZoomTimeoutID) clearTimeout(this.clearZoomTimeoutID)
        this.style.willChange = "transform"
    }

    /** Post pinch or pan cleanup */
    private gestureEnd(e?:PointerEvent){
        this.mode = "none"
        this.style.willChange = ""
        if(this._scale <= 1 ){
            this.clearZoom()
        }
    }

    /** aka. scale. */
    get zoom(){
        return this._scale
    }

    /**
     * Is the transform anything other than identity / none?
     */
    get isTransformed(){
        return this._scale != 1 || this._translation.x != 0 || this._translation.y != 0
    }

    /** The coordinates that the zoom is centered on. */
    get zoomOrigin(){
        return Object.freeze(Object.apply({},this.origin))
    }

    /**
     * Immediately set the zoom of the element. Calls while gesturing are ignored
     * @param withScale the scale to end up at
     * @param atX where to zoom into
     * @param atY where to zoom into
     * @param animate should animate change. Default is false.
     * @param center center/pan the content so that the origin is in the middle of the element. Default is false
     */
    doPinch(withScale:number,atX:number,atY:number,animate=false,center=false){

        // if(this.gesturing){
        //     console.warn("ZoomPanel:: can't set zoom while gesturing")
        //     return
        // }

        // start
        this.style.transition =  animate ? `all ${defaultEaseTime}s` : "none"
        this.style.transitionTimingFunction = defaultEase;
        // if(animate) this.style.willChange = "transform"

        this.initialCenter = {
            x:atX,
            y:atY
        }

        // barf. TODO: clean this all up
        this.initialDistance = 100
        this.pinchDistance = 100 + 100 * (withScale - this._scale)
        this.pinchScale    = (this.pinchDistance / this.initialDistance)

        let newCenterX = center ? this.untransformedBoundingClientRect.width/2 : atX
        let newCenterY = center ? this.untransformedBoundingClientRect.height/2 : atY

        this.gesturePositionChange.x =  newCenterX - this.initialCenter.x * this.pinchScale
        this.gesturePositionChange.y =  newCenterY - this.initialCenter.y * this.pinchScale

        // console.log("gesture pos change",this.gesturePositionChange)

        let absoluteScale       = this.pinchScale * this.initialScale
        let absoluteOffsetX     = this.gesturePositionChange.x + this.initialGesturePosition.x * this.pinchScale
        let absoluteOffsetY     = this.gesturePositionChange.y + this.initialGesturePosition.y * this.pinchScale

        // do transform
        this.setTransform(absoluteOffsetX,absoluteOffsetY,absoluteScale);

        // cache values
        this.origin.x = newCenterX;
        this.origin.y = newCenterY;

        // cleanup
        this.initialCenter.x = 0
        this.initialCenter.y = 0
        this.initialScale    *= this.pinchScale
        this.initialGesturePosition.x  = this.initialGesturePosition.x * this.pinchScale + this.gesturePositionChange.x
        this.initialGesturePosition.y  = this.initialGesturePosition.y * this.pinchScale + this.gesturePositionChange.y

    }

    /**
     * perform a pinch such that the final scale is scale, and X/Y are based on scale of 1...
     * @param scale
     * @param atX
     * @param atY
     * @param animate
     * @param center
     */
    pinchTo(scale:number,atX:number,atY:number,animate=false,center=false,time=defaultEaseTime,easing:string=defaultEase){
        console.log("animate",animate,time,easing)
        // start

        this.style.transition =  animate ? `all ${time}s ` : "none"
        this.style.transitionTimingFunction = easing;
        if(animate) this.style.willChange = "transform"

        // set initial conditions.
        this.initialCenter = {
            x:atX,
            y:atY
        }
        this._scale = 1;
        this.initialScale = 1;
        this.initialDistance = 100;
        this.initialGesturePosition.x = 0
        this.initialGesturePosition.y = 0
        this._translation.x = 0
        this._translation.y = 0

        // perform a pinch from initial conditions...

        this.initialDistance = 100
        this.pinchDistance = 100 + 100 * (scale - this._scale)
        this.pinchScale    = (this.pinchDistance / this.initialDistance)

        let newCenterX = center ? this.untransformedBoundingClientRect.width/2 : atX
        let newCenterY = center ? this.untransformedBoundingClientRect.height/2 : atY

        this.gesturePositionChange.x =  newCenterX - this.initialCenter.x * this.pinchScale
        this.gesturePositionChange.y =  newCenterY - this.initialCenter.y * this.pinchScale

        let absoluteScale       = this.pinchScale * this.initialScale
        let absoluteOffsetX     = this.gesturePositionChange.x + this.initialGesturePosition.x * this.pinchScale
        let absoluteOffsetY     = this.gesturePositionChange.y + this.initialGesturePosition.y * this.pinchScale

        // do transform
        this.setTransform(absoluteOffsetX,absoluteOffsetY,absoluteScale);

        // cache values
        this.origin.x = newCenterX;
        this.origin.y = newCenterY;

        // cleanup
        this.initialCenter.x = 0
        this.initialCenter.y = 0
        this.initialScale    *= this.pinchScale
        this.initialGesturePosition.x  = this.initialGesturePosition.x * this.pinchScale + this.gesturePositionChange.x
        this.initialGesturePosition.y  = this.initialGesturePosition.y * this.pinchScale + this.gesturePositionChange.y
    }

    _debugElement?:HTMLDivElement

    /** Create the debug view */
    debug(){
        if(this._debugElement) return;
        // setup
        this._debugElement = document.createElement("div")
        this._debugElement.id = "--zoom-panel-debug-" + Math.random(); // :P
        this.appendChild(this._debugElement)
        Object.assign(this._debugElement.style,{
            pointerEvents:"none",
            position : "absolute",
            top:"0px",
            left:"0px",
            width : "100%",
            height : "100%",
            overflow : "visible",
            zIndex : "999999999999999",
            backgroundColor:"#00ff0022",
            color:"white",
            fontFamily:"helvetica,Arial,sans-serif",
        })

        // view panel
        const viewport = document.createElement("div")
        this._debugElement.appendChild(viewport)
        Object.assign(viewport.style,{
            backgroundColor:"transparent",
            outline:"10px solid palegreen",
            position:"absolute",
            pointerEvents:"none",

            width:this.viewport.width +"px",
            height:this.viewport.height +"px",
            top:this.viewport.top +"px",
            left:this.viewport.top +"px",
        });

        // canvas
        const canvas = document.createElement("canvas")
        canvas.setAttribute("width",this.untransformedBoundingClientRect.width + "px")
        canvas.setAttribute("height",this.untransformedBoundingClientRect.height + "px")

        this._debugElement.appendChild(canvas)
        Object.assign(canvas.style,{
            pointerEvents:"none",
            position:"absolute",
            top:"0px",
            left:"0px",
            width:this.untransformedBoundingClientRect.width + "px",
            height:this.untransformedBoundingClientRect.height +"px",
            backgroundColor:"transparent",
            outline:"10px solid purple",
            outlineOffset:"-5px",
            transformOrigin:"0 0"
        });
        const ctx = canvas.getContext("2d")

         // vitals
         const vitals = document.createElement("div")
         this._debugElement.appendChild(vitals)
         Object.assign(vitals.style,{
             pointerEvents:"none",
             position : "absolute",
             top:"0px",
             left:"0px",
             width : "100%",
             height : "100%",
             fontSize:"0.8rem",
             transformOrigin:"0 0"
         })

        //
        console.warn("starting zoom panel debug loop!")
        const debugLoop = ()=>{

            // vitals
            Object.assign(vitals.style,{
                // transform:`translate(${-this.translation.x}px, ${-this.translation.y}px)`
                transform:`translate(${-this.translation.x / this.scale}px, ${-this.translation.y / this.scale}px) scale(${1/this.scale}) `
            });
            vitals.innerHTML = `
                <div style="background-color:#000000cc;width:fit-content;"><Zoom-Panel> Debug:</div>
                <div style="background-color:#000000cc;width:fit-content;">mode: ${this.mode}</div>
                <div style="background-color:#000000cc;width:fit-content;">pointers: ${this.pointers.length}</div>
                <div style="background-color:#000000cc;width:fit-content;">bbox: ${JSON.stringify(this.untransformedBoundingClientRect)}</div>
                <div style="background-color:#000000cc;width:fit-content;">transform: ${this.style.transform}</div>
            `


            // viewport
            Object.assign(viewport.style,{
                width:this.viewport.width +"px",
                height:this.viewport.height +"px",
                top:this.viewport.top +"px",
                left:this.viewport.top +"px",
            });


            // canvas
            if(canvas.width != this.untransformedBoundingClientRect.width) canvas.setAttribute("width",this.untransformedBoundingClientRect.width + "px")
            if(canvas.height != this.untransformedBoundingClientRect.height) canvas.setAttribute("height",this.untransformedBoundingClientRect.height + "px")

            Object.assign(canvas.style,{
                // transform:`translate(${-this.translation.x}px, ${-this.translation.y}px)`
                transform:`translate(${-this.translation.x / this.scale}px, ${-this.translation.y / this.scale}px) scale(${1/this.scale}) `
            });

            ctx.clearRect(0,0,canvas.width,canvas.height);
            ctx.lineWidth = 4;
            ctx.strokeStyle = "#00ffff"
            this.pointers.forEach(p=>{
                let size = p.pointerType == "touch"
                    ? 100
                    : 20
                ctx.strokeRect(
                    p.clientX - size/2,
                    p.clientY - size/2,
                    size,size
                )
            })
            // const center = this.center;
            // ctx.fillStyle = "#00ffffaa"
            // ctx.fillRect(
            //     center.x,
            //     center.y,
            //     2,
            //     2
            // )

            window.requestAnimationFrame(debugLoop)
        }
        window.requestAnimationFrame(debugLoop);

        return this._debugElement
    }

    /** Get a point in the middle of the zoom-panel viewport translated to  */
    get center(){

        let p = {
            x:this.untransformedBoundingClientRect.width/2,
            y:this.untransformedBoundingClientRect.height/2
        }

        p.x -= this.translation.x
        p.y -= this.translation.y

        return {
            x:0,
            y:0
        }
    }

    /** A rect representing the bounding box within the transformed element*/
    get viewport(){
        let bbox:Rect = JSON.parse(JSON.stringify(this.untransformedBoundingClientRect));


        /** We need the bbox in relation to this element */
        bbox.top = 0;
        bbox.left = 0;

        bbox.left -= this.translation.x / this.scale;
        bbox.top -= this.translation.y / this.scale;
        bbox.width /= this.scale;
        bbox.height /= this.scale;

        return bbox;
    }

    frame(
        rect:Rect,
        animate = true
    ){

        let x = rect.left + rect.width/2;
        let y = rect.top + rect.height/2;
        let maxWidthScale = this.untransformedBoundingClientRect.width/rect.width;
        let maxHeightScale = this.untransformedBoundingClientRect.height/rect.height;
        let scale = Math.min(maxWidthScale,maxHeightScale)


        this.pinchTo(scale,x,y,animate,true);
    }

    frameChild(
        el:Element,
        padding = {
            top:20,
            right:20,
            bottom:20,
            left:20,
        }
    ){
        if(el == null || el == undefined){
            console.warn("frameChild(null) no go")
            return;
        }
        const {top, left, width, height } = el.getBoundingClientRect();
        let bbox = {top, left, width, height};

        // let currentTransform = new WebKitCSSMatrix(window.getComputedStyle(this).transform);

        let currentTranslation = {
            x:this.currentTransform.x,
            y:this.currentTransform.y
        }
        let currentScale = this.currentTransform.scale;

        // offset for this offset.
        bbox.top  -= this.untransformedBoundingClientRect.top
        bbox.left -= this.untransformedBoundingClientRect.left

        // peal off zoom-panel transform
        bbox.top    -= currentTranslation.y;
        bbox.left   -= currentTranslation.x;
        bbox.width  /= currentScale
        bbox.height /= currentScale
        bbox.top    /= currentScale;
        bbox.left   /= currentScale;

        // adjust w/ padding
        bbox.top -= padding.top
        bbox.left -= padding.left
        bbox.height += padding.top + padding.bottom
        bbox.width += padding.left + padding.right

        this.frame(bbox);
    }

    /**
     * Center on the center of a child element
     * @param scale The absolute scale to end up at
     * @param el the element whose center to focus on
     */
    focusChild(scale:number,el:Element,animate=true,center=true,time=0.5,easing:string=defaultEase){
        if(el == null || el == undefined){
            console.warn("frameChild(null) no go")
            return;
        }
        const {top, left, width, height } = el.getBoundingClientRect();
        let bbox = {top, left, width, height};

        let currentTransform = new WebKitCSSMatrix(window.getComputedStyle(this).transform);

        let currentTranslation = {
            x:currentTransform.e,
            y:currentTransform.f
        }
        let currentScale = currentTransform.a;

        // offset for this offset.
        bbox.top  -= this.untransformedBoundingClientRect.top
        bbox.left -= this.untransformedBoundingClientRect.left

        // peal off zoom-panel transform
        bbox.top    -= currentTranslation.y;
        bbox.left   -= currentTranslation.x;
        bbox.width  /= currentScale
        bbox.height /= currentScale
        bbox.top    /= currentScale;
        bbox.left   /= currentScale;

        let centerOn = {
            x:bbox.left + bbox.height/2,
            y:bbox.top + bbox.height/2,
        }
        this.pinchTo(scale,centerOn.x,centerOn.y,animate,center,time,easing)
    }

    /**
     * Put a hard stop to tracking any user touch input.
     * Any current pointer-touches on screen become dead to us.
     * */
    clearManipulation(){
        this.mode = "none"
        this.pointers.length = 0;
        this._flushCachedBoundingRect();
        this.dispatchEvent(new CustomEvent("didClearManipulation"))
    }

    /**
     * Animate a return to scale 0 and no pan. Clear the pointers list just in case.
     * @param duration MILLISECONDS
     * @param ease
     */
    clearZoom(duration?:number, ease?:string){
        this.clearManipulation();
        if(!this.isTransformed){
            this.dispatchEvent(new CustomEvent("zoomDidClear"))
            return;
        }
        duration = duration == undefined ?  defaultEaseTime * 1000 : duration;
        this._scale    = 1;
        this._translation.x = 0
        this._translation.y = 0
        this.origin.x = 0;
        this.origin.y = 0;
        this.initialCenter.x = 0
        this.initialCenter.y = 0
        this.initialScale    = 1
        this.initialGesturePosition.x  = 0
        this.initialGesturePosition.y  = 0
        this.style.willChange = `transform`
        this.setTransform(0,0,1)
        this.style.transition = `all ${duration}ms`
        if(ease) this.style.transitionTimingFunction = ease;

        // TODO? use transitionEnd event handler?
        if(this.clearZoomTimeoutID) clearTimeout(this.clearZoomTimeoutID)
        this.clearZoomTimeoutID = setTimeout(()=>{
            if(!this.gesturing){
                this.style.willChange = ``
                this.clearManipulation();
                this._flushCachedBoundingRect();
            }
            this.dispatchEvent(new CustomEvent("zoomDidClear"))
            //else // warn -- clearZoom timeout was not cleared properly
        },duration + 50)
    }


}

customElements.define('zoom-panel',ZoomPanel)

export default ZoomPanel