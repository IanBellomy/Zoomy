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

export function isRect(r:any):r is Rect{
    return typeof r.top == "number" &&
        typeof r.left == "number" &&
        typeof r.width == "number" &&
        typeof r.height == "number"
}

export type TransformationReason = "frame"|"gesture"
export type TransformationState = "Start"|"Change"|"End"
export type TransformationEventType = string;// `${TransformationReason}${TransformationState}`
export const GestureTypes = ["pinch","pan","doubleTap","scroll"] as const;
export type GestureType = typeof GestureTypes[number]|"manipulation";
export type GestureEventType = string;//`${GestureType}${TransformationState}`|`${GestureType}Will${TransformationState}`
export type ZoomPanelEventType = TransformationEvent|"didClearManipulation"|"zoomDidClear"
export class TransformationEvent<BE extends PointerEvent|WheelEvent = PointerEvent|WheelEvent> extends Event{
    constructor(
        type:GestureEventType,
        readonly baseEvent?:BE
    ){
        super(type);
    }

    shouldStopPropagation = false;
    shouldStopImmediatePropagation = false;

    stopPropagation(): void {
        this.shouldStopPropagation = true;
        super.stopPropagation();
    }

    stopImmediatePropagation(): void {
        this.shouldStopImmediatePropagation = true;
        super.stopImmediatePropagation()
    }
}

/**
 * @param val A matrix string retrieved from getComputedStyle
 */
export function matrixStringToTransform(val:string){
    const values = val.split('(')[1].split(')')[0].split(',');
    const a = parseFloat(values[0]);
    const d = parseFloat(values[3]);
    const tx = parseFloat(values[4]);
    const ty = parseFloat(values[5]);

    return {
        scale: a == d ? a : undefined,
        scaleX: a,
        scaleY: d,
        translate:{
            x:tx,
            y:ty
        } as Point
    }
}

/**
 * In seconds
 */
const defaultEaseTime = 0.65

/**
 * Used for animating to put a rect into view
 */
const defaultEase = "cubic-bezier(0.375, 0.115, 0.000, 1.000);"

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

    /**
     * If true, stylus-events are completely ignored.
     */
    ignoreStylus = false;

    /**
     * If true, touch events will captured and not passed down to children of the zoom panel
     * */
    captureTouch = false

    /** A cache of pointerEvents active on this element; alternative to touchEvent.touches  */
    private pointers:PointerEvent[] = []
    /** What kind of gesture is the user performing, if any */
    private mode:"none"|GestureType = "none"

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
    /** The current distance of a pinch during a pinch gesture while it is underway */
    private pinchDistance = undefined
    /** The initial scale of the zoom panel when a pinch or pan begins */
    private initialScale = 1
    /** The current scale change of a pinch gesture while the gesture is underway. This always starts at 1 when a pinch begins. */
    private pinchScale = undefined
    /** The initial transformation of the zoom panel when a pinch or pan began */
    private translationAtGestureStart:Point = {x:0,y:0}
    /** The the position of the current center point during a gesture  relative to the initial point */
    private gesturePositionChange:Point = {x:0,y:0}
    /** The zoom-panel element's bounding box. */
    private _cachedBoundingBox:{width:number,height:number,top:number,left:number} = null

    /** time (ms) of last pointerDown */
    private lastPointTime = undefined
    /** location of last pointerDown */
    private lastPointPos:Point = {x:0,y:0}
    /** Maximum time that can pass between taps for two taps to count as a double tap */
    private doubleTapTime = 300
    public centerOnDoubleTap = true
    /** Used for the mouseWheelTimeout complete */
    private mouseWheelTimeoutID = undefined

    /**
     * clearZoom uses a delay to dispatch a zoomClear event
     * @deprecated
     * */
    // private clearZoomTimeoutID = undefined

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
                        break;
                        case "pan":
                        this.panEnd();
                        break;
                }
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

    private _handleResize(info:any){
        // let vp = this.querySelector("#viewportCheck");
        // this._cachedViewport = undefined
        this._flushCachedBoundingRect();
        // the issue is we need to accommodate the shift in content scale :P
        // this.frameChild(vp,{},false);
        // re-cache
        // this._cachedViewport = this.viewport;
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
        this.handlePointerDownCapture = this.handlePointerDownCapture.bind(this)
        this.handlePointerDown = this.handlePointerDown.bind(this)
        this.handlePointerMoveCapture = this.handlePointerMoveCapture.bind(this)
        this.handleMainWindowVisibilityChange = this.handleMainWindowVisibilityChange.bind(this)
        this.handleMouseWheelCapture = this.handleMouseWheelCapture.bind(this)
        this.handleContextMenu = this.handleContextMenu.bind(this)
    }

    resizeObserver:ResizeObserver|null =
        ResizeObserver ?
            new ResizeObserver((e)=>{
                this._handleResize(e);
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
        this.addEventListener("pointerdown",this.handlePointerDownCapture,{capture:true})

        // BUBBLE listener
        // if a pointerdown event bubbles up into the zoom panel, un-captured, then the user may want to pan...
        this.addEventListener("pointerdown",this.handlePointerDown)

        // ...
        this.addEventListener("pointermove",this.handlePointerMoveCapture,{capture:true})


        // Listen during capture on document to prevent elements from swallowing this event and leaving our cache borked.
        // Should there be a global cache manager?
        document.addEventListener("pointerup",this.handlePointerUp,{capture:true})
        document.addEventListener("pointercancel",this.handlePointerUp,{capture:true})
        document.addEventListener("contextmenu",this.handleContextMenu,{capture:true})

        // this.addEventListener("pointerout",handlePointerUp,{capture:true})        // should handle these?...  nope — can drag gesture out of zoom area. what
        // this.addEventListener("pointerleave",handlePointerUp,{capture:true})
        // document.addEventListener("pointercancel",handlePointerUp,{capture:true})

        // this.addEventListener("pointerup",(e)=>{
        //     if(this.gesturing) e.stopImmediatePropagation();
        // },{capture:true})

        // this.addEventListener("pointercancel",this.pinchEnd.bind(this),{capture:true})

        this.addEventListener("wheel",this.handleMouseWheelCapture,{capture:true})

        document.addEventListener("visibilitychange", this.handleMainWindowVisibilityChange, {capture:true});

        // Transition listeners
        this.addEventListener("transitionend",e=>{
            if(this._debugElement) console.info("transition ended",this.translation,this.scale)
            // Force browser to re-render at new scale
            this.style.willChange = ""

            // Check for zoom clear
            if(
                this.scale == 1 &&
                this.translation.x == 0 &&
                this.translation.y == 0
            ){
                // clear shit :P
                this._scale    = 1;
                this._translation.x = 0
                this._translation.y = 0
                this.origin.x = 0;
                this.origin.y = 0;
                this.initialCenter.x = 0
                this.initialCenter.y = 0
                this.initialScale    = 1
                this.translationAtGestureStart.x  = 0
                this.translationAtGestureStart.y  = 0
                this.dispatchEvent(new CustomEvent("zoomDidClear"))
            }
        })
        this.addEventListener("transitioncancel",e=>{
            // console.info("t cancel")
            // this.style.willChange = ""
        })

        //
        // Default behaviors
        //
        this.addEventListener("doubleTapEnd",this.handleDoubleTap.bind(this))
        this.addEventListener("manipulationEnd",this.handleManipulationEnd.bind(this))
    }

    addEventListener<K extends (keyof HTMLElementEventMap)|ZoomPanelEventType>(type: K, listener: (this: HTMLElement, ev: HTMLElementEventMap|TransformationEvent) => any, options?: boolean | AddEventListenerOptions): void;
    addEventListener(type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions): void;
    addEventListener(type: unknown, listener: unknown, options?: unknown): void {
        //@ts-expect-error
        super.addEventListener(type,listener,options)
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

    handlePointerDownCapture(e:PointerEvent){
        if(this.mode == "scroll"){
            clearTimeout(this.mouseWheelTimeoutID)
            // debugger;
        }
        if(!this.manipulationAllowed) return;
        if(e.pointerType == "pen" && this.ignoreStylus) return;

        // update cached pointers
        this.pointers.push(e)

        // FIXME: We should cache the pointers somehow and apply them at the end to make sure nothing can mutates the pointer array while we're still working through it...
        // For example, if the user touches during a non-gesture animated pinch we'll 'cancel that gesture' and start another with the new event.
        // But the default behavior of gesture end is to check for being zoomed out too far and then clear zoom, which ideally would have a clearManipulation call
        // But clearManipulation will clear all the pointers, leaving us with none, and the pinchStart will fail.
        // But the gesture logic is looking at the pointer array, so we need to add first.

        if(this.pointers.length == 2 && this.mode=="none"){
            // managed to put down two fingers at the "same" time, e.g. between event-loop ticks.
            this.pinchStart(e)
        }else if(this.pointers.length == 2 && this.mode=="pan"){
            // Added a finger during a pan gesture. [Can happen if we were pinching, then lifted, then placed another finger]
            this.panEnd(e)
            this.pinchStart(e)
        }else if(
            this.pointers.length == 1 &&
            (this.mode == "none" || this.mode == "scroll")){

            if(this.mode == "scroll") this.scrollEnd();

            let currentTime = new Date().getTime();
            // console.log("Double? ",(currentTime - this.lastPointTime))
            if(this.lastPointTime && (currentTime - this.lastPointTime) < this.doubleTapTime ){
                // clear pointer cache
                this.pointers.length = 0
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

        if(this.gesturing){
            e.preventDefault()
            e.stopImmediatePropagation()
        }

        if(e.pointerType == "touch" && this.captureTouch){
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation()
        }

        if(e.pointerType == "touch" && this.ignoreStylus){
            e.preventDefault();
        }

        if(this.pointers.length == 8){
            if(
                !this._debugElement &&
                confirm("Enable Zoom-panel debug mode?")
            ){
                this.debug();
            }
        }
    }

    handlePointerDown(e:PointerEvent){
        if(!this.manipulationAllowed) return;
        if(e.pointerType == "pen" && this.ignoreStylus) return;

        // ignore input if flags say so
        if( (e.pointerType == "touch" && this.panRequiresTwoFingers) ||
            (e.pointerType == "mouse" && !this.panWithMouse) ||
            (e.pointerType == "pen" && !this.panWithPen)) return;


        if(!this.gesturing && this.pointers.length == 1){
            // console.log("ZoomPanel:: un-captured pointerdown bubbling while zoomed, assuming pan is desired...",e)
            e.stopImmediatePropagation();
            this.panStart(e)
            // from this point, zoom panel will capture pointer events going downhill and call panMove()
        }
    }

    handlePointerMoveCapture(e:PointerEvent){
        if(this._debugElement) console.log(
            "manipulationallowed " +this.manipulationAllowed,
            "mode: " + this.mode
        )
        if(!this.manipulationAllowed) return;
        if(e.pointerType == "pen" && this.ignoreStylus) return;

        // update cached pointers
        for(let i = 0; i < this.pointers.length; i++){
            if(this.pointers[i].pointerId == e.pointerId) this.pointers[i] = e
        }

        if(this.pointers.length >= 2 && this.mode=="none"){
            // two fingers came out of nowhere!
            this.pinchStart(e)
        } else if(this.pointers.length >= 2 && this.mode =="pinch"){
            this.pinchMove(e)
        } else if(this.pointers.length >= 2 && this.mode == "pan"){
            // finger came out of nowhere!
            this.pinchEnd(e)
            this.panStart(e)
        }else if(this.pointers.length == 1 && this.mode == "pan"){
            // this.dispatchEvent(new CustomEvent("manipulationStart"))         // ?!
            this.panMove(e)
        }



        if(this.gesturing){
            e.preventDefault()
            e.stopImmediatePropagation()
        }
    }

    handlePointerUpCapture(e:PointerEvent){
        if(e.pointerType == "touch" && this.captureTouch){
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation()

            // If we capture touches on the way down, the'll never bubble up.
            // So just handle it
            this.handlePointerUp(e);
        }
    }

    /**
     * When the context menu opens it swallows subsequent pointer events.
     * So let's just cut off whatever is going on.
     * @param e
     */
    handleContextMenu(e:MouseEvent){
        this.clearManipulation();
    }

    handlePointerUp(e:PointerEvent){
        if(e.pointerType == "pen" && this.ignoreStylus) return;

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

        // Warning: Do not preventDefault or stopPropagation for context menu events!
        if(e.type == "contextmenu"){
            return;
        }

        if(this.pointers.length == 0 && this.mode=="pinch"){
            // Removed multiple fingers at the "same time".
            e.preventDefault()
            e.stopImmediatePropagation()
            this.pinchEnd(e)
        } else if(this.pointers.length == 0 && this.mode=="pan"){
            // Removed the last finger while panning, e.g. when there was only one finger to remove
            e.preventDefault()
            e.stopImmediatePropagation()
            this.panEnd(e)
        }else if(this.pointers.length == 1 && this.mode == "pinch"){
            // Removed all but one finger during a pinch gesture.
            e.preventDefault()
            e.stopImmediatePropagation()
            this.pinchEnd(e)
            this.panStart(this.pointers[0]) // the remaining pointer
        }

        // TODO: Consider: If the gesture is done, should we allow the event to continue down into children?
    }

    private handleMouseWheelCapture(e:WheelEvent){
        if(!this.manipulationAllowed) return;
        this.mode = "scroll";
        let targetScale = this._scale - e.deltaY/750
        this.style.willChange = "transform"
        this.style.transition = ""
        this.doPinch(targetScale, e.clientX - this.untransformedBoundingClientRect.left, e.clientY - this.untransformedBoundingClientRect.top)

        if(this.mouseWheelTimeoutID) clearTimeout(this.mouseWheelTimeoutID)
        else this.dispatchEvent(new TransformationEvent("manipulationStart",e))

        this.mouseWheelTimeoutID = setTimeout(()=>{
            this.scrollEnd()
        },750) // genuinely don't remember why this has to be here... I feel like there was some aesthetic issue with zooming out far and having the default snap back to scale 1 behavior feel weird.
    }

    /**
     * Note: a double tap isn't a 'manipulation' per se.
     * It's just idiomatic to interpret it as a "zoom in/out" command.
     * So we perform that transformation as a default response to the doubleTapEnd event.
     * @see handleDoubleTap
     */
    private doubleTap(e:PointerEvent){
        this.dispatchEvent(new TransformationEvent("doubleTapEnd",e))
    }

    /**
     * Called when a a second  point is detected (during pointer-start or pointermove)
     */
    private pinchStart(e:PointerEvent){
        if(this.gesturing) return
        if(!(e instanceof PointerEvent)){
            console.error("pinchStart called without pointer event!")
            return;
        }

        this.gestureWillBegin("pinch",e)

        this.mode = "pinch"

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
        this.initialScale = this.scale;

        this.debugPinch.ix = this.initialCenter.x
        this.debugPinch.iy = this.initialCenter.y
        this.debugPinch.ir = this.initialDistance

        if(this._debugElement){
            console.log("pinchStart",this.debugPinch)
            console.log("   initialDistance",this.initialDistance)
            console.log("   bbox",this.untransformedBoundingClientRect)
        }
        this.dispatchEvent(new TransformationEvent("pinchStart",e))
        this.dispatchEvent(new TransformationEvent("manipulationStart",e))

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
        let absoluteOffsetX     = this.gesturePositionChange.x + this.translationAtGestureStart.x * this.pinchScale
        let absoluteOffsetY     = this.gesturePositionChange.y + this.translationAtGestureStart.y * this.pinchScale


        this.debugPinch.x = newCenterX
        this.debugPinch.y = newCenterY
        this.debugPinch.r = this.pinchDistance

        // do transform
        this.setTransform(absoluteOffsetX,absoluteOffsetY,absoluteScale);

        // cache values
        this.origin.x = newCenterX;
        this.origin.y = newCenterY;

        if(this._debugElement){
            console.log("pinchMove",this.debugPinch)
            console.log("   pinchDistance",this.pinchDistance)
            console.log("   initialDistance",this.initialDistance)
            console.log("   (new) pinchScale",this.pinchScale)
            console.log("   bbox",this.untransformedBoundingClientRect)
            console.log("   gesturePositionChange.x",this.gesturePositionChange.x)
            console.log("   gesturePositionChange.y",this.gesturePositionChange.y)

            console.log("   absoluteScale",absoluteScale)
            console.log("   absoluteOffsetX",absoluteOffsetX)
            console.log("   absoluteOffsetY",absoluteOffsetY)
        }
        this.dispatchEvent(new TransformationEvent("pinchChange",e))
    }

    private debugPinch = {
        /** Current pinch center X */
        x:0,
        /** Current pinch center Y */
        y:0,
        /** Current pinch radius */
        r:0,
        /** Current pinch initial center x */
        ix:0,
        /** Current pinch initial center y */
        iy:0,
        /** Current pinch initial radius */
        ir:0
    }

    /**
     * Called when a user lifts a finger while pinching, after pinchEnd().
     * TODO: Call if nothing inside captures a pointer event...
     */
    private panStart(e:PointerEvent){
        if(this.gesturing) return
        if(!(e instanceof PointerEvent)){
            console.error("panStart called without pointer event!")
            return;
        }

        this.gestureWillBegin("pan",e)
        this.mode = "pan"

        // console.log("pan start",e)
        this.style.transition = "none"
        this.style.willChange = "transform"
        // Fixme: If we triple click, the double tap will activate a transition, and the third will start a pan, mid transition, snapping the zoom to the final size.
        // It looks/feels gross. We might either check for triple tap, or set the transform to whatever it is mid transform.



        this.initialCenter.x = e.clientX - this.untransformedBoundingClientRect.left
        this.initialCenter.y = e.clientY - this.untransformedBoundingClientRect.top

        this.initialScale = this.scale;

        // as-if moved in case panEnd is called directly afterwards.
        // as-if moved in case pinchEnd is called directly afterwards.
        this.pinchScale = 1
        this.gesturePositionChange.x = 0
        this.gesturePositionChange.y = 0
        this.pinchDistance = this.initialDistance

        this.dispatchEvent(new TransformationEvent("pinchStart",e))
        this.dispatchEvent(new TransformationEvent("manipulationStart",e))
    }

    /**
     * Called when moving one finger after panStart()
     */
    private panMove(e:PointerEvent){
        // console.log("pan move ",e)

        // issue transitioning from two point to one point move...
        // need to preserve the scale of the two point move.
        this.pinchScale    = 1

        let newCenterX = e.clientX - this.untransformedBoundingClientRect.left
        let newCenterY = e.clientY - this.untransformedBoundingClientRect.top

        this.gesturePositionChange.x =  newCenterX - this.initialCenter.x * this.pinchScale
        this.gesturePositionChange.y =  newCenterY - this.initialCenter.y * this.pinchScale

        let absoluteScale       = this.pinchScale * this.initialScale
        let absoluteOffsetX     = this.gesturePositionChange.x + this.translationAtGestureStart.x * this.pinchScale
        let absoluteOffsetY     = this.gesturePositionChange.y + this.translationAtGestureStart.y * this.pinchScale

        // do transform
        this.setTransform(absoluteOffsetX,absoluteOffsetY,absoluteScale);

        // cache values
        this.origin.x = newCenterX;
        this.origin.y = newCenterY;

        this.dispatchEvent(new TransformationEvent("panChange",e))
    }

    private panEnd(e?:PointerEvent){
        if(!this.gesturing) return
        this.gestureWillEnd("pan")
        this.mode = "none"
        // pretty sure this doesn't need to be exactly the same as pinchEnd. But to be safe...
        this.initialCenter.x = undefined
        this.initialCenter.y = undefined
        this.initialScale    *= this.pinchScale // hmm....
        this.translationAtGestureStart.x  = this.translationAtGestureStart.x * this.pinchScale + this.gesturePositionChange.x
        this.translationAtGestureStart.y  = this.translationAtGestureStart.y * this.pinchScale + this.gesturePositionChange.y
        this.pinchDistance = undefined
        this.gesturePositionChange = {x:0,y:0}
        this.pinchScale = undefined
        this.style.willChange = ""

        this.dispatchEvent(new TransformationEvent("panEnd",e))
        this.dispatchEvent(new TransformationEvent("manipulationEnd",e))
    }

    private pinchEnd(e?:PointerEvent){
        if(!this.gesturing) return
        this.gestureWillEnd("pinch")
        this.mode = "none"
        this.initialCenter.x = undefined
        this.initialCenter.y = undefined
        this.initialScale    *= this.pinchScale
        this.translationAtGestureStart.x  = this.translationAtGestureStart.x * this.pinchScale + this.gesturePositionChange.x
        this.translationAtGestureStart.y  = this.translationAtGestureStart.y * this.pinchScale + this.gesturePositionChange.y
        this.pinchDistance = undefined
        this.gesturePositionChange = {x:0,y:0}
        this.pinchScale = undefined
        this.style.willChange = ""

        this.dispatchEvent(new TransformationEvent("pinchEnd",e))
        this.dispatchEvent(new TransformationEvent("manipulationEnd",e))
    }

    private scrollEnd(){
        if(!this.gesturing) return
        this.gestureWillEnd("scroll")
        clearTimeout(this.mouseWheelTimeoutID);
        this.mode ="none"
        this.mouseWheelTimeoutID = undefined
        this.style.willChange = ""
        this.dispatchEvent(new TransformationEvent("scrollEnd"))
        this.dispatchEvent(new TransformationEvent("manipulationEnd"))
    }

    /** Called before a pan or pinch begins while not doing either */
    private gestureWillBegin(
        gesture:GestureType,
        /** The event where a gesture was detected */
        e:PointerEvent,
    ){
        if(this._debugElement) console.info("GestureWillBegin",gesture,e)

        // if(this.clearZoomTimeoutID) clearTimeout(this.clearZoomTimeoutID)

        // Check for ongoing animations
        this.interruptTransitions();

        // note the initial offset
        this.translationAtGestureStart.x = this.translation.x
        this.translationAtGestureStart.y = this.translation.y

        // Good luck, browser...
        this.style.willChange = "transform"
    }

    get isTransitioning(){
        return this.getAnimations().length != 0
    }

    /**
     * Cancel any ongoing transitions and apply the in-progress transform.
     */
    private interruptTransitions(){
        const currentAnimations = this.getAnimations()
        if(currentAnimations.length){
            if(this._debugElement) console.log("interrupt transition while transform is",this.style.transform)
            currentAnimations.forEach(a=>a.pause());
            let matrixString = this.computedStyle.getPropertyValue("transform")
            if(matrixString.includes("matrix")){
                let transform = matrixStringToTransform(matrixString);
                this.setTransform(
                    transform.translate.x,
                    transform.translate.y,
                    transform.scale,
                )
            }else{
                console.warn("Transformation is not a matrix")
            }
            currentAnimations.forEach(a=>a.cancel());
            this.style.transition = "none"
        }else{
            if(this._debugElement) console.info("No animations to interrupt")
        }

        if(this._debugElement) console.log("transition now",this.style.transform)
    }

    private gestureWillEnd(
        gesture:GestureType,
        e?:PointerEvent|WheelEvent
    ){
        if(this._debugElement) console.info("gestureWillEnd",gesture,e)
        this.dispatchEvent(new TransformationEvent("manipulationWillEnd",e))
    }

    /**
     * Post pinch or pan cleanup
     * @deprecated The pan/pinch end methods are just dispatching their own manipulation end events
     * */
    private gestureDidEnd(
        gesture:GestureType,
        e?:PointerEvent|WheelEvent,
    ){
        if(this._debugElement) console.info("GestureDidEnd",gesture,e)
        // this.dispatchEvent(new GestureEvent("manipulationEnd",e))
    }

    //
    // default behaviors
    //

    // WARNING: This may run before all pointer/mouse events have been dealt with.
    handleManipulationEnd(e:TransformationEvent){
        // TODO: Need a setting for whether to do this...

        // WARNING: Don't clear if there are still pointers -- there may be another gesture incoming.
        if(this.pointers.length==0){
            if(this._scale <= 1 ){
                this.clearZoom()
            }
        }
    }

    handleDoubleTap(e:TransformationEvent<PointerEvent>){
        // if(e.pointerType == "pen" && this.ignoreStylus) return;
        if(this._scale > 1){
            // TODO: this should be frameChild(this)
            this.clearZoom()
        }else{
            let x = e.baseEvent.clientX
            let y = e.baseEvent.clientY
            this.doPinch(2,x - this.untransformedBoundingClientRect.left, y - this.untransformedBoundingClientRect.top,true,this.centerOnDoubleTap)
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

        // TESTING!
        // let defaultEaseTime = 35

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
        let absoluteOffsetX     = this.gesturePositionChange.x + this.translationAtGestureStart.x * this.pinchScale
        let absoluteOffsetY     = this.gesturePositionChange.y + this.translationAtGestureStart.y * this.pinchScale

        // do transform
        this.setTransform(absoluteOffsetX,absoluteOffsetY,absoluteScale);

        // cache values
        this.origin.x = newCenterX;
        this.origin.y = newCenterY;

        // cleanup
        this.initialCenter.x = 0
        this.initialCenter.y = 0
        this.initialScale    *= this.pinchScale
        this.translationAtGestureStart.x  = this.translationAtGestureStart.x * this.pinchScale + this.gesturePositionChange.x
        this.translationAtGestureStart.y  = this.translationAtGestureStart.y * this.pinchScale + this.gesturePositionChange.y

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
        this.translationAtGestureStart.x = 0
        this.translationAtGestureStart.y = 0
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
        let absoluteOffsetX     = this.gesturePositionChange.x + this.translationAtGestureStart.x * this.pinchScale
        let absoluteOffsetY     = this.gesturePositionChange.y + this.translationAtGestureStart.y * this.pinchScale

        // do transform
        this.setTransform(absoluteOffsetX,absoluteOffsetY,absoluteScale);

        // cache values
        this.origin.x = newCenterX;
        this.origin.y = newCenterY;

        // cleanup
        this.initialCenter.x = 0
        this.initialCenter.y = 0
        this.initialScale    *= this.pinchScale
        this.translationAtGestureStart.x  = this.translationAtGestureStart.x * this.pinchScale + this.gesturePositionChange.x
        this.translationAtGestureStart.y  = this.translationAtGestureStart.y * this.pinchScale + this.gesturePositionChange.y
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
            width : "0px",
            height : "0px",
            overflow : "visible",
            zIndex : "999999999999999",
            backgroundColor:"#00ff0022",
            color:"white",
            fontFamily:"helvetica,Arial,sans-serif",
        })

         // vitals
         const vitals = document.createElement("div")
         this._debugElement.appendChild(vitals)
         Object.assign(vitals.style,{
             pointerEvents:"none",
             position : "absolute",
             display:"flex",
             flexDirection:"column",
             top:"12px",
             left:"12px",
             width : "0px",
             height : "0px",
             overflow:"visible",
             fontSize:"0.8rem",
             transformOrigin:"0 0",
             boxSizing:"border-box"
         })

         // viewportCheck
         const viewportCheck = document.createElement("div")
         viewportCheck.id = "viewportCheck"
         this._debugElement.appendChild(viewportCheck)
         Object.assign(viewportCheck.style,{
             pointerEvents:"none",
             position : "absolute",
             display:"flex",
             flexDirection:"column",
             overflow:"visible",
             transformOrigin:"0 0",
             outline:"24px solid #ff0000",
             outlineOffset:"-12px",
             opacity:0.4,
         })

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
            outline:"10px solid #00ffff66",
            outlineOffset:"-5px",
            transformOrigin:"0 0"
        });
        const ctx = canvas.getContext("2d")

        //
        console.warn("starting zoom panel debug loop!")
        const debugLoop = ()=>{

            // vitals
            Object.assign(vitals.style,{
                transform:`translate(${-this.translation.x / this.scale}px, ${-this.translation.y / this.scale}px) scale(${1/this.scale}) `
            });

            vitals.innerHTML = `
                <div style="background-color:#00000066;width:max-content;">Pointers: ${this.pointers.length}</div>
                <div style="background-color:#00000066;width:max-content;">mode: ${this.mode}</div>
                <div style="background-color:#00000066;width:max-content;">manipulation allowed: ${this.manipulationAllowed}</div>
                <div style="background-color:#00000066;width:max-content;">target transform: ${this.style.transform}</div>
                <div style="background-color:#00000066;width:max-content;">transition: ${this.style.transition}</div>
                <div style="background-color:#00000066;width:max-content;">Zoom-Panel element client bbox:<br>${JSON.stringify(this.untransformedBoundingClientRect).split('"').join("").split(",").join("<br/>")}</div>
            `

            // canvas
            if(canvas.width != this.untransformedBoundingClientRect.width) canvas.setAttribute("width",this.untransformedBoundingClientRect.width + "px")
            if(canvas.height != this.untransformedBoundingClientRect.height) canvas.setAttribute("height",this.untransformedBoundingClientRect.height + "px")

            Object.assign(canvas.style,{
                transform:`translate(${-this.translation.x / this.scale}px, ${-this.translation.y / this.scale}px) scale(${1/this.scale}) `,
                width:this.untransformedBoundingClientRect.width + "px",
                height:this.untransformedBoundingClientRect.height +"px",
            });

            ctx.clearRect(0,0,canvas.width,canvas.height);

            // draw pointers
            ctx.lineWidth = 4;
            ctx.strokeStyle = "#00ffff"
            this.pointers.forEach(p=>{
                let size = p.pointerType == "touch"
                    ? 100
                    : 20
                ctx.setLineDash([]);
                ctx.strokeRect(
                    p.clientX - size/2,
                    p.clientY - size/2,
                    size,size
                )
            })

            if(this.mode == "pinch"){
                ctx.lineWidth = 1;
                // initial pinch
                ctx.beginPath()
                ctx.setLineDash([5, 5]);
                ctx.ellipse(
                    this.debugPinch.ix,
                    this.debugPinch.iy,
                    this.debugPinch.ir/2,
                    this.debugPinch.ir/2,
                    0,0,Math.PI*2
                )
                ctx.stroke()

                ctx.lineWidth = 2;
                // current pinch
                ctx.beginPath()
                ctx.setLineDash([2, 2]);
                ctx.ellipse(
                    this.debugPinch.x,
                    this.debugPinch.y,
                    this.debugPinch.r/2,
                    this.debugPinch.r/2,
                    0,0,Math.PI*2
                )
                ctx.stroke()

            }


            // place viewport
            let viewport = this.viewport;
            viewportCheck.style.width = this.viewport.width + "px";
            viewportCheck.style.height = this.viewport.height + "px";
            viewportCheck.style.top = viewport.top + "px";
            viewportCheck.style.left = viewport.left + "px";

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

    /**
     * We need the viewport dimensions on resize
     */
    _cachedViewport = this.viewport;

    /**
     * A rect, representing the bounding box within the transformed element.
     * */
    get viewport(){
        let bbox:Rect = JSON.parse(JSON.stringify(this.untransformedBoundingClientRect));

        /** We need the bbox in relation to this element */
        bbox.top = 0;
        bbox.left = 0;

        bbox.left -= this.translation.x / this.scale;
        bbox.top -= this.translation.y / this.scale;
        bbox.width /= this.scale;
        bbox.height /= this.scale;

        this._cachedViewport = bbox

        return bbox;
    }

    frame(
        rect:Rect,
        animate = true,
        roundFactor = 100
    ){
        if(!isRect(rect)){
            console.error("frame(rect:Rect,animate = true) rect param must be a Rect! Received",rect)
            return;
        }

        let x = rect.left + rect.width/2;
        let y = rect.top + rect.height/2;
        let maxWidthScale = this.untransformedBoundingClientRect.width/rect.width;
        let maxHeightScale = this.untransformedBoundingClientRect.height/rect.height;
        let scale = Math.min(maxWidthScale,maxHeightScale)

        x = Math.floor(x*roundFactor)/roundFactor;
        y = Math.floor(y*roundFactor)/roundFactor;
        scale = Math.floor(scale*roundFactor)/roundFactor;

        this.pinchTo(scale,x,y,animate,true);
    }

    frameChild(
        el:Element,
        /** Include a visual safe area around element */
        padding = {
            top:20,
            right:20,
            bottom:20,
            left:20,
        } as Partial<{
            top:number,
            right:number,
            bottom:number,
            left:number,
        }>,
        /** animate the transition */
        animate = true,
        /** round the target transform */
        roundFactor = 10
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

        padding.top = padding.top || 0;
        padding.left = padding.left || 0;
        padding.right = padding.right || 0;
        padding.bottom = padding.bottom || 0;

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

        this.frame(bbox,animate,roundFactor);
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
        if(this._debugElement) console.log("willClearManipulation");
        this.pointers.length = 0;
        switch(this.mode){
            case "pinch": this.pinchEnd();
            case "pan": this.panEnd();
            case "scroll" : this.scrollEnd();
        }
        // reset bbox just in case
        this._flushCachedBoundingRect();
        this.dispatchEvent(new CustomEvent("didClearManipulation"))
    }

    /**
     * Animate a return to scale 0 and no pan.
     * This exists (rather than a frame(boundingBox)) for bespoke duration and ease and the need to fire off a zoomDidClear event if it's already cleared :P
     * @param duration MILLISECONDS
     * @param ease
     */
    clearZoom(duration?:number, ease?:string){
        // this.clearManipulation()?; // Issue here. If we switch from an animated pinch to a pan, clear manipulation will clear pointers we're about to use...
        if(!this.isTransformed){
            this.dispatchEvent(new CustomEvent("zoomDidClear"))
            return;
        }
        duration = duration == undefined ?  defaultEaseTime * 1000 : duration;
        this.style.willChange = `transform`
        this.style.transition = `all ${duration}ms`
        if(ease) this.style.transitionTimingFunction = ease;
        this.setTransform(0,0,1)
    }


}

customElements.define('zoom-panel',ZoomPanel)

export default ZoomPanel