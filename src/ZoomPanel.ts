interface Point{
    x:number,
    y:number
} 

interface Rect{
    top:number,
    left:number,
    width:number,
    height:number
}

/**
 * An element that users can pinch-to-zoom and pan.
 */
class ZoomPanel extends HTMLElement{

    /** A cache of pointerEvents active on this element; alernative to touchEvent.touches  */
    private pointers:PointerEvent[] = []
    /** What kind of gesture is the user performing, if any */
    private mode:"none"|"pinch"|"pan"|"doubletap" = "none"
    /** The absolute scale the element is at right now. Set using doPinch(...) */
    private scale = 1
    private translation = {x:0,y:0}
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
    /** The element's bounding box */
    private _cachedBoundingBox:{width:number,height:number,top:number,left:number} = null 

    /** time (ms) of last pointerDown*/
    private lastPointTime = undefined
    /** location of last pointerDown */
    private lastPointPos:Point = {x:0,y:0}
    /** Maximum time that can pass between taps for two taps to count as a double tap */
    private doubleTapTime = 300 
    public centerOnDoubleTap = false
    /** Used for the mouseWheelTimeout complete */
    private mouseWheelTimoutID = undefined

    /** clearZoom uses a delay to dispatch a zoomclear event */
    private clearZoomTimeoutID = undefined

    /** Whether or not a user is pinching or panning */
    get gesturing(){
        return this.mode != "none"
    }
    
    /** bounding box (cached) */
    get boundingBox(){
        if(this._cachedBoundingBox == null){
            this._cachedBoundingBox = this.getBoundingClientRect()            
        }
        return this._cachedBoundingBox
    }

    constructor(){
        super()
    }
    
    connectedCallback(){        
        
        // Add basic event listeners that determine pan/pinch start/move/end and capture events as needed. 
        
        this.addEventListener("pointerdown",(e)=>{
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

        },{capture:true})

        // BUBBLE listener
        // if a pointerdown event bubbles up into the zoom panel, uncaptured, then the user may want to pan...
        this.addEventListener("pointerdown",(e)=>{       
            if(!this.gesturing && this.pointers.length == 1){                
                // console.log("ZoomPanel:: uncaptured pointerdown bubbling while zoomed, assuming pan is desired...",e)
                e.stopImmediatePropagation();                
                this.gestureWillBegin()                
                this.panStart(e)
                this.dispatchEvent(new CustomEvent("panStart")) 
                this.dispatchEvent(new CustomEvent("manipulationStart")) // TODO: Undo previous tap action? 
                // from this point, zoom panel will capture pointer events going downhill and call panMove()
            }
        })

        this.addEventListener("pointermove",(e)=>{                
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
        
        
        let handlePointerUp = (e:PointerEvent)=>{
            // update cached pointers
            for(let i = 0; i < this.pointers.length; i++){
                if(this.pointers[i].pointerId == e.pointerId) this.pointers.splice(i,1)				
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
        
        // Listen during capture on document to prevent elements from swallowing this event and leving our cache borked.         
        // Should there be a global cache manager?
        document.addEventListener("pointerup",handlePointerUp,{capture:true})        
        // this.addEventListener("pointerout",handlePointerUp,{capture:true})        // shouldhandle these?...  nope — can drag gesture out of zoom area. what
        // this.addEventListener("pointerleave",handlePointerUp,{capture:true})        
        // document.addEventListener("pointercancel",handlePointerUp,{capture:true})        

        // this.addEventListener("pointerup",(e)=>{
        //     if(this.gesturing) e.stopImmediatePropagation();
        // },{capture:true})

        // this.addEventListener("pointercancel",this.pinchEnd.bind(this),{capture:true})
        // this.addEventListener("pointercancel",this.pinchEnd.bind(this),{capture:true})        

        this.addEventListener("mousewheel",this.handleMouseWheel.bind(this),{capture:true})
    }

    private handleMouseWheel(e){
        let targetScale = this.scale - e.deltaY/750            
        
        this.style.transition = "none"
        this.doPinch(targetScale, e.clientX - this.boundingBox.left, e.clientY - this.boundingBox.top)
        
        if(this.mouseWheelTimoutID) clearTimeout(this.mouseWheelTimoutID)
        else this.dispatchEvent(new CustomEvent("manipulationStart"))

        this.mouseWheelTimoutID = setTimeout(()=>{
            this.mouseWheelTimoutID = undefined
            this.gestureEnd()
        },300)
    }

    private doubleTap(e:PointerEvent){
        // console.log("doubletap")
        if(this.scale > 1) this.clearZoom()
        else{
            let x = e.clientX
            let y = e.clientY
            this.doPinch(2,x - this.boundingBox.left, y - this.boundingBox.top,true,this.centerOnDoubleTap)
        }
        
    }

    /**
     * Called when a a second  point is detected (during pointerstart or pointermove)
     */
    private pinchStart(e:PointerEvent){
        if(this.gesturing) return
        else this.mode = "pinch"

        // console.log("pinch start",e)
        this.style.transition = "none"
        // this.style.willChange = "transform"

        this.initialCenter.x = (this.pointers[1].clientX + this.pointers[0].clientX)/2 - this.boundingBox.left
        this.initialCenter.y = (this.pointers[1].clientY + this.pointers[0].clientY)/2 - this.boundingBox.top       

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

        let newCenterX = (this.pointers[1].clientX + this.pointers[0].clientX)/2 - this.boundingBox.left
        let newCenterY = (this.pointers[1].clientY + this.pointers[0].clientY)/2 - this.boundingBox.top

        this.gesturePositionChange.x =  newCenterX - this.initialCenter.x * this.pinchScale
        this.gesturePositionChange.y =  newCenterY - this.initialCenter.y * this.pinchScale

        let absoluteScale       = this.pinchScale * this.initialScale
        let absoluteOffsetX     = this.gesturePositionChange.x + this.initialGesturePosition.x * this.pinchScale
        let absoluteOffsetY     = this.gesturePositionChange.y + this.initialGesturePosition.y * this.pinchScale                
 
        this.translation.x = absoluteOffsetX
        this.translation.y = absoluteOffsetY
        
        // do transform
        this.style.transform = `translate(${absoluteOffsetX}px, ${absoluteOffsetY}px) scale(${absoluteScale})`
        this.style.transformOrigin = `0 0`
        
        // cache values
        this.scale    = absoluteScale;
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
        // this.style.willChange = "transform"

        let x = e.clientX
        let y = e.clientY
        
        this.initialCenter.x = x - this.boundingBox.left
        this.initialCenter.y = y - this.boundingBox.top

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
            
        let newCenterX = x - this.boundingBox.left
        let newCenterY = y - this.boundingBox.top
                
        this.gesturePositionChange.x =  newCenterX - this.initialCenter.x * this.pinchScale
        this.gesturePositionChange.y =  newCenterY - this.initialCenter.y * this.pinchScale
 
        let absoluteScale       = this.pinchScale * this.initialScale
        let absoluteOffsetX     = this.gesturePositionChange.x + this.initialGesturePosition.x * this.pinchScale
        let absoluteOffsetY     = this.gesturePositionChange.y + this.initialGesturePosition.y * this.pinchScale               
 
        this.translation.x = absoluteOffsetX
        this.translation.y = absoluteOffsetY

        // do transform
        this.style.transform = `translate(${absoluteOffsetX}px, ${absoluteOffsetY}px) scale(${absoluteScale})`
        this.style.transformOrigin = `0 0`
        
        // cache values
        this.scale    = absoluteScale;
        this.origin.x = newCenterX;
        this.origin.y = newCenterY;         
    }

    private panEnd(e:PointerEvent){        
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

    private pinchEnd(e:PointerEvent){
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
        if(this.scale <= 1 ){
            this.clearZoom()
        }
    }

    /** aka. scale. */
    get zoom(){
        return this.scale
    }

    /** The cordinates that the zoom is centered on. */
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
        if(this.gesturing){
            console.warn("ZoomPanel:: can't set zoom while gesturing")
            return
        }

        // start
        this.style.transition =  animate ? "transform 0.65s" : "none"
        // if(animate) this.style.willChange = "transform"

        this.initialCenter = {
            x:atX,
            y:atY
        }

        // barf. TODO: clean this all up
        this.initialDistance = 100 
        this.pinchDistance = 100 + 100 * (withScale - this.scale)
        this.pinchScale    = (this.pinchDistance / this.initialDistance)                                
                
        let newCenterX = center ? this.boundingBox.width/2 : atX
        let newCenterY = center ? this.boundingBox.height/2 : atY
        
        this.gesturePositionChange.x =  newCenterX - this.initialCenter.x * this.pinchScale
        this.gesturePositionChange.y =  newCenterY - this.initialCenter.y * this.pinchScale

        // console.log("gesture pos change",this.gesturePositionChange)

        let absoluteScale       = this.pinchScale * this.initialScale
        let absoluteOffsetX     = this.gesturePositionChange.x + this.initialGesturePosition.x * this.pinchScale
        let absoluteOffsetY     = this.gesturePositionChange.y + this.initialGesturePosition.y * this.pinchScale               

        this.translation.x = absoluteOffsetX
        this.translation.y = absoluteOffsetY

        // do transform
        this.style.transform = `translate(${absoluteOffsetX}px, ${absoluteOffsetY}px) scale(${absoluteScale})`
        this.style.transformOrigin = `0 0`
        
        // cache values
        this.scale    = absoluteScale;
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
    pinchTo(scale:number,atX:number,atY:number,animate=false,center=false){
        // start
        this.style.transition =  animate ? "transform 0.35s" : "none"
        // if(animate) this.style.willChange = "transform"

        
        // set initial conditions.
        this.initialCenter = {
            x:atX,
            y:atY
        }
        this.scale = 1;
        this.initialScale = 1;
        this.initialDistance = 100;
        this.initialGesturePosition.x = 0
        this.initialGesturePosition.y = 0
        this.translation.x = 0
        this.translation.y = 0

        // perform a pinch from initial conditions...

        this.initialDistance = 100 
        this.pinchDistance = 100 + 100 * (scale - this.scale)
        this.pinchScale    = (this.pinchDistance / this.initialDistance)               
                
        let newCenterX = center ? this.boundingBox.width/2 : atX
        let newCenterY = center ? this.boundingBox.height/2 : atY
        
        this.gesturePositionChange.x =  newCenterX - this.initialCenter.x * this.pinchScale
        this.gesturePositionChange.y =  newCenterY - this.initialCenter.y * this.pinchScale

        let absoluteScale       = this.pinchScale * this.initialScale
        let absoluteOffsetX     = this.gesturePositionChange.x + this.initialGesturePosition.x * this.pinchScale
        let absoluteOffsetY     = this.gesturePositionChange.y + this.initialGesturePosition.y * this.pinchScale                

        this.translation.x = absoluteOffsetX
        this.translation.y = absoluteOffsetY

        // do transform
        this.style.transform = `translate(${absoluteOffsetX}px, ${absoluteOffsetY}px) scale(${absoluteScale})`
        this.style.transformOrigin = `0 0`
        
        // cache values
        this.scale    = absoluteScale;
        this.origin.x = newCenterX;
        this.origin.y = newCenterY;
        
        // cleanup
        this.initialCenter.x = 0
        this.initialCenter.y = 0
        this.initialScale    *= this.pinchScale
        this.initialGesturePosition.x  = this.initialGesturePosition.x * this.pinchScale + this.gesturePositionChange.x
        this.initialGesturePosition.y  = this.initialGesturePosition.y * this.pinchScale + this.gesturePositionChange.y
    }
        
    frame(
        rect:Rect                
    ){

        let x = rect.left + rect.width/2;
        let y = rect.top + rect.height/2;
        let maxWidthScale = this.boundingBox.width/rect.width;
        let maxHeightScale = this.boundingBox.height/rect.height;
        let scale = Math.min(maxWidthScale,maxHeightScale)

        this.pinchTo(scale,x,y,true,true);
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
        const {top, left, width, height } = el.getBoundingClientRect();			
        let bbox = {top, left, width, height};
                
        let currentTransform = new WebKitCSSMatrix(window.getComputedStyle(this).transform);
        
        let currentTranslation = { 
            x:currentTransform.e,
            y:currentTransform.f
        }
        let currentScale = currentTransform.a;

        // offset for this offset.
        bbox.top  -= this.boundingBox.top
        bbox.left -= this.boundingBox.left 

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

    /** Animate a return to scale 0 and no pan. Clear the pointers list just in case. */
    clearZoom(){        
        this.pointers.length = 0;
        this.scale    = 1;
        this.translation.x = 0
        this.translation.y = 0
        this.origin.x = 0;
        this.origin.y = 0;        
        this.initialCenter.x = 0
        this.initialCenter.y = 0
        this.initialScale    = 1
        this.initialGesturePosition.x  = 0
        this.initialGesturePosition.y  = 0                
        this.style.willChange = `transform`
        this.style.transform = `translate(0px, 0px) scale(1)`
        this.style.transformOrigin = `0 0`
        this.style.transition = "transform 0.65s"
        if(this.clearZoomTimeoutID) clearTimeout(this.clearZoomTimeoutID)
        this.clearZoomTimeoutID = setTimeout(()=>{
            if(!this.gesturing) this.style.willChange = ``
            this.dispatchEvent(new CustomEvent("zoomDidClear"))
            //else // warn -- clearZoom timeout was not cleared properly
        },700)
    }

    
}

customElements.define('zoom-panel',ZoomPanel)

export default ZoomPanel