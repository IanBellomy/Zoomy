export function isRect(r) {
    return typeof r.top == "number" &&
        typeof r.left == "number" &&
        typeof r.width == "number" &&
        typeof r.height == "number";
}
export const GestureTypes = ["pinch", "pan", "doubleTap", "scroll"];
export class TransformationEvent extends Event {
    constructor(type, baseEvent) {
        super(type);
        this.baseEvent = baseEvent;
        this.shouldStopPropagation = false;
        this.shouldStopImmediatePropagation = false;
    }
    stopPropagation() {
        this.shouldStopPropagation = true;
        super.stopPropagation();
    }
    stopImmediatePropagation() {
        this.shouldStopImmediatePropagation = true;
        super.stopImmediatePropagation();
    }
}
export function matrixStringToTransform(val) {
    const values = val.split('(')[1].split(')')[0].split(',');
    const a = parseFloat(values[0]);
    const d = parseFloat(values[3]);
    const tx = parseFloat(values[4]);
    const ty = parseFloat(values[5]);
    return {
        scale: a == d ? a : undefined,
        scaleX: a,
        scaleY: d,
        translate: {
            x: tx,
            y: ty
        }
    };
}
const defaultEaseTime = 0.65;
const defaultEase = "cubic-bezier(0.375, 0.115, 0.000, 1.000);";
class ZoomPanel extends HTMLElement {
    get scale() {
        return this._scale;
    }
    get translation() {
        return this._translation;
    }
    get computedStyle() {
        if (this._cachedComputedStyle == null) {
            this._cachedComputedStyle = window.getComputedStyle(this);
        }
        window.requestAnimationFrame(() => {
            this._cachedComputedStyle = null;
        });
        return window.getComputedStyle(this);
    }
    get currentTransform() {
        if (this._cachedCurrentTransform == null) {
            let matrix = new WebKitCSSMatrix(this.computedStyle.transform);
            this._cachedCurrentTransform = {
                x: matrix.e,
                y: matrix.f,
                scale: matrix.a
            };
        }
        window.requestAnimationFrame(() => {
            this._cachedCurrentTransform = null;
        });
        return this._cachedCurrentTransform;
    }
    get matrix() {
        return new DOMMatrix().translateSelf(this.translation.x, this.translation.y, 0).scaleSelf(this.scale, this.scale);
    }
    get svgMatrix() {
        let m = document.createElementNS("http://www.w3.org/2000/svg", "svg").createSVGMatrix();
        m = m.scale(this.scale, this.scale);
        return m;
    }
    get manipulationAllowed() { return this._manipulationAllowed; }
    set manipulationAllowed(val) {
        this._manipulationAllowed = val;
        if (!val) {
            debugger;
            this.pointers.length = 0;
            if (this.gesturing) {
                switch (this.mode) {
                    case "pinch":
                        this.pinchEnd();
                        break;
                    case "pan":
                        this.panEnd();
                        break;
                }
            }
        }
    }
    get gesturing() {
        return this.mode != "none";
    }
    get untransformedBoundingClientRect() {
        if (this._cachedBoundingBox == null) {
            this._cachedBoundingBox = this.getBoundingClientRect();
        }
        return this._cachedBoundingBox;
    }
    _flushCachedBoundingRect() {
        let tempTransformSave = this.style.transform;
        let tempTransition = this.style.transition;
        this.style.transition = "none";
        this.style.transform = "";
        this._cachedBoundingBox = this.getBoundingClientRect();
        this.style.transform = tempTransformSave;
        let _ = this.offsetWidth;
        this.style.transition = tempTransition;
        return this._cachedBoundingBox;
    }
    _handleResize() {
        this._flushCachedBoundingRect();
    }
    setTransform(x, y, scale) {
        let roundFactor = 1000;
        x = Math.floor(x * roundFactor) / roundFactor;
        y = Math.floor(y * roundFactor) / roundFactor;
        scale = Math.floor(scale * roundFactor) / roundFactor;
        this.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
        this._translation.x = x;
        this._translation.y = y;
        this._scale = scale;
    }
    constructor() {
        super();
        this.panRequiresTwoFingers = true;
        this.panWithMouse = true;
        this.panWithPen = false;
        this.pointers = [];
        this.mode = "none";
        this._scale = 1;
        this._translation = { x: 0, y: 0 };
        this._cachedComputedStyle = null;
        this._cachedCurrentTransform = null;
        this.origin = { x: 0, y: 0 };
        this.initialCenter = { x: 0, y: 0 };
        this.initialDistance = 0;
        this.pinchDistance = undefined;
        this.initialScale = 1;
        this.pinchScale = undefined;
        this.translationAtGestureStart = { x: 0, y: 0 };
        this.gesturePositionChange = { x: 0, y: 0 };
        this._cachedBoundingBox = null;
        this.lastPointTime = undefined;
        this.lastPointPos = { x: 0, y: 0 };
        this.doubleTapTime = 300;
        this.centerOnDoubleTap = false;
        this.mouseWheelTimeoutID = undefined;
        this.clearZoomTimeoutID = undefined;
        this._manipulationAllowed = true;
        this.resizeObserver = ResizeObserver ?
            new ResizeObserver((e) => {
                this._handleResize();
            })
            : null;
        this._handleResize = this._handleResize.bind(this);
        this._flushCachedBoundingRect = this._flushCachedBoundingRect.bind(this);
        this.handlePointerUp = this.handlePointerUp.bind(this);
        this.handlePointerDownCapture = this.handlePointerDownCapture.bind(this);
        this.handlePointerDown = this.handlePointerDown.bind(this);
        this.handlePointerMoveCapture = this.handlePointerMoveCapture.bind(this);
        this.handleMainWindowVisibilityChange = this.handleMainWindowVisibilityChange.bind(this);
        this.handleMouseWheelCapture = this.handleMouseWheelCapture.bind(this);
    }
    connectedCallback() {
        var _a;
        this.style.transformOrigin = `0 0`;
        (_a = this.resizeObserver) === null || _a === void 0 ? void 0 : _a.observe(this);
        if (!this.resizeObserver) {
            window.addEventListener("resize", this._handleResize);
        }
        this.addEventListener("pointerdown", this.handlePointerDownCapture, { capture: true });
        this.addEventListener("pointerdown", this.handlePointerDown);
        this.addEventListener("pointermove", this.handlePointerMoveCapture, { capture: true });
        document.addEventListener("pointerup", this.handlePointerUp, { capture: true });
        document.addEventListener("pointercancel", this.handlePointerUp, { capture: true });
        document.addEventListener("contextmenu", this.handlePointerUp, { capture: true });
        this.addEventListener("wheel", this.handleMouseWheelCapture, { capture: true });
        document.addEventListener("visibilitychange", this.handleMainWindowVisibilityChange, { capture: true });
        this.addEventListener("transitionend", e => {
            this.style.willChange = "";
        });
        this.addEventListener("transitioncancel", e => {
        });
        this.addEventListener("doubleTapEnd", this.handleDoubleTap.bind(this));
        this.addEventListener("manipulationEnd", this.handleManipulationEnd.bind(this));
    }
    addEventListener(type, listener, options) {
        super.addEventListener(type, listener, options);
    }
    handleMainWindowVisibilityChange(e) {
        this.clearManipulation();
    }
    disconnectedCallback() {
        var _a;
        (_a = this.resizeObserver) === null || _a === void 0 ? void 0 : _a.unobserve(this);
        if (!this.resizeObserver) {
            window.removeEventListener("resize", this._handleResize);
        }
        document.removeEventListener("pointerup", this.handlePointerUp, { capture: true });
    }
    handlePointerDownCapture(e) {
        if (!this.manipulationAllowed)
            return;
        this.pointers.push(e);
        if (this.pointers.length == 2 && this.mode == "none") {
            this.pinchStart(e);
        }
        else if (this.pointers.length == 2 && this.mode == "pan") {
            this.panEnd(e);
            this.pinchStart(e);
        }
        else if (this.pointers.length == 1 && this.mode == "none") {
            let currentTime = new Date().getTime();
            if (this.lastPointTime && (currentTime - this.lastPointTime) < this.doubleTapTime) {
                this.pointers.length = 0;
                this.pointers.push(e);
                e.stopImmediatePropagation();
                e.preventDefault();
                this.doubleTap(e);
            }
            else {
                this.lastPointTime = currentTime;
                this.lastPointPos.x = this.pointers[0].clientX;
                this.lastPointPos.y = this.pointers[0].clientY;
            }
        }
        if (this.gesturing) {
            e.preventDefault();
            e.stopImmediatePropagation();
        }
        if (this.pointers.length == 6) {
            if (!this._debugElement &&
                confirm("Enable Zoom-panel debug mode?")) {
                this.debug();
            }
        }
    }
    handlePointerDown(e) {
        if (!this.manipulationAllowed)
            return;
        if ((e.pointerType == "touch" && this.panRequiresTwoFingers) ||
            (e.pointerType == "mouse" && !this.panWithMouse) ||
            (e.pointerType == "pen" && !this.panWithPen))
            return;
        if (!this.gesturing && this.pointers.length == 1) {
            e.stopImmediatePropagation();
            this.panStart(e);
        }
    }
    handlePointerMoveCapture(e) {
        if (!this.manipulationAllowed)
            return;
        for (let i = 0; i < this.pointers.length; i++) {
            if (this.pointers[i].pointerId == e.pointerId)
                this.pointers[i] = e;
        }
        if (this.pointers.length >= 2 && this.mode == "none") {
            this.pinchStart(e);
        }
        else if (this.pointers.length >= 2 && this.mode == "pinch") {
            this.pinchMove(e);
        }
        else if (this.pointers.length >= 2 && this.mode == "pan") {
            this.pinchEnd(e);
            this.panStart(e);
        }
        else if (this.pointers.length == 1 && this.mode == "pan") {
            this.panMove(e);
        }
        if (this.gesturing) {
            e.preventDefault();
            e.stopImmediatePropagation();
        }
    }
    handlePointerUp(e) {
        let removedPointerEvent = null;
        for (let i = 0; i < this.pointers.length; i++) {
            if (this.pointers[i].pointerId == e.pointerId)
                removedPointerEvent = this.pointers.splice(i, 1)[0];
        }
        if (removedPointerEvent === null) {
            console.warn("pointer up handled but did not find its pointerId in tracked pointers!");
        }
        if (!this.manipulationAllowed) {
            if (removedPointerEvent) {
                console.warn("pointer up handled and found pointer to remove but it shot not have been there because manipulationAllowed was false!");
            }
            return;
        }
        if (e.type == "contextmenu") {
            return;
        }
        if (this.pointers.length == 0 && this.mode == "pinch") {
            e.preventDefault();
            e.stopImmediatePropagation();
            this.pinchEnd(e);
        }
        else if (this.pointers.length == 0 && this.mode == "pan") {
            e.preventDefault();
            e.stopImmediatePropagation();
            this.panEnd(e);
        }
        else if (this.pointers.length == 1 && this.mode == "pinch") {
            e.preventDefault();
            e.stopImmediatePropagation();
            this.pinchEnd(e);
            this.panStart(this.pointers[0]);
        }
    }
    handleMouseWheelCapture(e) {
        if (!this.manipulationAllowed)
            return;
        this.mode = "scroll";
        let targetScale = this._scale - e.deltaY / 750;
        this.style.willChange = "transform";
        this.style.transition = "";
        this.doPinch(targetScale, e.clientX - this.untransformedBoundingClientRect.left, e.clientY - this.untransformedBoundingClientRect.top);
        if (this.mouseWheelTimeoutID)
            clearTimeout(this.mouseWheelTimeoutID);
        else
            this.dispatchEvent(new TransformationEvent("manipulationStart", e));
        this.mouseWheelTimeoutID = setTimeout(() => {
            this.scrollEnd();
        }, 750);
    }
    doubleTap(e) {
        this.dispatchEvent(new TransformationEvent("doubleTapEnd", e));
    }
    pinchStart(e) {
        if (this.gesturing)
            return;
        if (!(e instanceof PointerEvent)) {
            console.error("pinchStart called without pointer event!");
            return;
        }
        this.gestureWillBegin("pinch", e);
        this.mode = "pinch";
        this.style.transition = "none";
        this.initialCenter.x = (this.pointers[1].clientX + this.pointers[0].clientX) / 2 - this.untransformedBoundingClientRect.left;
        this.initialCenter.y = (this.pointers[1].clientY + this.pointers[0].clientY) / 2 - this.untransformedBoundingClientRect.top;
        let distanceX = (this.pointers[1].clientX - this.pointers[0].clientX);
        let distanceY = (this.pointers[1].clientY - this.pointers[0].clientY);
        this.initialDistance = Math.sqrt(distanceX * distanceX + distanceY * distanceY);
        this.pinchScale = 1;
        this.gesturePositionChange.x = 0;
        this.gesturePositionChange.y = 0;
        this.pinchDistance = this.initialDistance;
        this.dispatchEvent(new TransformationEvent("pinchStart", e));
        this.dispatchEvent(new TransformationEvent("manipulationStart", e));
    }
    pinchMove(e) {
        let distanceX = (this.pointers[1].clientX - this.pointers[0].clientX);
        let distanceY = (this.pointers[1].clientY - this.pointers[0].clientY);
        this.pinchDistance = Math.sqrt(distanceX * distanceX + distanceY * distanceY);
        this.pinchScale = (this.pinchDistance / this.initialDistance);
        let newCenterX = (this.pointers[1].clientX + this.pointers[0].clientX) / 2 - this.untransformedBoundingClientRect.left;
        let newCenterY = (this.pointers[1].clientY + this.pointers[0].clientY) / 2 - this.untransformedBoundingClientRect.top;
        this.gesturePositionChange.x = newCenterX - this.initialCenter.x * this.pinchScale;
        this.gesturePositionChange.y = newCenterY - this.initialCenter.y * this.pinchScale;
        let absoluteScale = this.pinchScale * this.initialScale;
        let absoluteOffsetX = this.gesturePositionChange.x + this.translationAtGestureStart.x * this.pinchScale;
        let absoluteOffsetY = this.gesturePositionChange.y + this.translationAtGestureStart.y * this.pinchScale;
        this.setTransform(absoluteOffsetX, absoluteOffsetY, absoluteScale);
        this.origin.x = newCenterX;
        this.origin.y = newCenterY;
        this.dispatchEvent(new TransformationEvent("pinchChange", e));
    }
    panStart(e) {
        if (this.gesturing)
            return;
        if (!(e instanceof PointerEvent)) {
            console.error("panStart called without pointer event!");
            return;
        }
        this.gestureWillBegin("pan", e);
        this.mode = "pan";
        this.style.transition = "none";
        this.initialCenter.x = e.clientX - this.untransformedBoundingClientRect.left;
        this.initialCenter.y = e.clientY - this.untransformedBoundingClientRect.top;
        this.initialScale = this.scale;
        this.pinchScale = 1;
        this.gesturePositionChange.x = 0;
        this.gesturePositionChange.y = 0;
        this.pinchDistance = this.initialDistance;
        this.dispatchEvent(new TransformationEvent("pinchStart", e));
        this.dispatchEvent(new TransformationEvent("manipulationStart", e));
    }
    panMove(e) {
        this.pinchScale = 1;
        let newCenterX = e.clientX - this.untransformedBoundingClientRect.left;
        let newCenterY = e.clientY - this.untransformedBoundingClientRect.top;
        this.gesturePositionChange.x = newCenterX - this.initialCenter.x * this.pinchScale;
        this.gesturePositionChange.y = newCenterY - this.initialCenter.y * this.pinchScale;
        let absoluteScale = this.pinchScale * this.initialScale;
        let absoluteOffsetX = this.gesturePositionChange.x + this.translationAtGestureStart.x * this.pinchScale;
        let absoluteOffsetY = this.gesturePositionChange.y + this.translationAtGestureStart.y * this.pinchScale;
        this.setTransform(absoluteOffsetX, absoluteOffsetY, absoluteScale);
        this.origin.x = newCenterX;
        this.origin.y = newCenterY;
        this.dispatchEvent(new TransformationEvent("panChange", e));
    }
    panEnd(e) {
        if (!this.gesturing)
            return;
        this.gestureWillEnd("pan");
        this.mode = "none";
        this.initialCenter.x = undefined;
        this.initialCenter.y = undefined;
        this.initialScale *= this.pinchScale;
        this.translationAtGestureStart.x = this.translationAtGestureStart.x * this.pinchScale + this.gesturePositionChange.x;
        this.translationAtGestureStart.y = this.translationAtGestureStart.y * this.pinchScale + this.gesturePositionChange.y;
        this.pinchDistance = undefined;
        this.gesturePositionChange = { x: 0, y: 0 };
        this.pinchScale = undefined;
        this.style.willChange = "";
        this.dispatchEvent(new TransformationEvent("panEnd", e));
        this.dispatchEvent(new TransformationEvent("manipulationEnd", e));
    }
    pinchEnd(e) {
        if (!this.gesturing)
            return;
        this.gestureWillEnd("pinch");
        this.mode = "none";
        this.initialCenter.x = undefined;
        this.initialCenter.y = undefined;
        this.initialScale *= this.pinchScale;
        this.translationAtGestureStart.x = this.translationAtGestureStart.x * this.pinchScale + this.gesturePositionChange.x;
        this.translationAtGestureStart.y = this.translationAtGestureStart.y * this.pinchScale + this.gesturePositionChange.y;
        this.pinchDistance = undefined;
        this.gesturePositionChange = { x: 0, y: 0 };
        this.pinchScale = undefined;
        this.style.willChange = "";
        this.dispatchEvent(new TransformationEvent("pinchEnd", e));
        this.dispatchEvent(new TransformationEvent("manipulationEnd", e));
    }
    scrollEnd() {
        if (!this.gesturing)
            return;
        this.gestureWillEnd("scroll");
        this.mode = "none";
        clearTimeout(this.mouseWheelTimeoutID);
        this.mouseWheelTimeoutID = undefined;
        this.style.willChange = "";
        this.dispatchEvent(new TransformationEvent("scrollEnd"));
        this.dispatchEvent(new TransformationEvent("manipulationEnd"));
    }
    gestureWillBegin(gesture, e) {
        console.info("GestureWillBegin", gesture, e);
        if (this.clearZoomTimeoutID)
            clearTimeout(this.clearZoomTimeoutID);
        this.interruptTransitions();
        this.translationAtGestureStart.x = this.translation.x;
        this.translationAtGestureStart.y = this.translation.y;
        this.style.willChange = "transform";
    }
    interruptTransitions() {
        const currentAnimations = this.getAnimations();
        if (currentAnimations.length) {
            let matrixString = this.computedStyle.getPropertyValue("transform");
            if (matrixString.includes("matrix")) {
                let transform = matrixStringToTransform(matrixString);
                this.setTransform(transform.translate.x, transform.translate.y, transform.scale);
            }
            else {
                console.info("Transformation is not");
            }
            currentAnimations.forEach(a => a.cancel());
            this.style.transition = "none";
        }
        else {
            console.info("No animations to interrupt");
        }
    }
    gestureWillEnd(gesture, e) {
        console.info("gestureWillEnd", gesture, e);
        this.dispatchEvent(new TransformationEvent("manipulationWillEnd", e));
    }
    gestureDidEnd(gesture, e) {
        console.info("GestureDidEnd", gesture, e);
    }
    handleManipulationEnd(e) {
        if (this.pointers.length == 0) {
            if (this._scale <= 1) {
                this.clearZoom();
            }
        }
    }
    handleDoubleTap(e) {
        if (this._scale > 1) {
            this.clearZoom();
        }
        else {
            let x = e.baseEvent.clientX;
            let y = e.baseEvent.clientY;
            this.doPinch(2, x - this.untransformedBoundingClientRect.left, y - this.untransformedBoundingClientRect.top, true, this.centerOnDoubleTap);
        }
    }
    get zoom() {
        return this._scale;
    }
    get isTransformed() {
        return this._scale != 1 || this._translation.x != 0 || this._translation.y != 0;
    }
    get zoomOrigin() {
        return Object.freeze(Object.apply({}, this.origin));
    }
    doPinch(withScale, atX, atY, animate = false, center = false) {
        this.style.transition = animate ? `all ${defaultEaseTime}s` : "none";
        this.style.transitionTimingFunction = defaultEase;
        this.initialCenter = {
            x: atX,
            y: atY
        };
        this.initialDistance = 100;
        this.pinchDistance = 100 + 100 * (withScale - this._scale);
        this.pinchScale = (this.pinchDistance / this.initialDistance);
        let newCenterX = center ? this.untransformedBoundingClientRect.width / 2 : atX;
        let newCenterY = center ? this.untransformedBoundingClientRect.height / 2 : atY;
        this.gesturePositionChange.x = newCenterX - this.initialCenter.x * this.pinchScale;
        this.gesturePositionChange.y = newCenterY - this.initialCenter.y * this.pinchScale;
        let absoluteScale = this.pinchScale * this.initialScale;
        let absoluteOffsetX = this.gesturePositionChange.x + this.translationAtGestureStart.x * this.pinchScale;
        let absoluteOffsetY = this.gesturePositionChange.y + this.translationAtGestureStart.y * this.pinchScale;
        this.setTransform(absoluteOffsetX, absoluteOffsetY, absoluteScale);
        this.origin.x = newCenterX;
        this.origin.y = newCenterY;
        this.initialCenter.x = 0;
        this.initialCenter.y = 0;
        this.initialScale *= this.pinchScale;
        this.translationAtGestureStart.x = this.translationAtGestureStart.x * this.pinchScale + this.gesturePositionChange.x;
        this.translationAtGestureStart.y = this.translationAtGestureStart.y * this.pinchScale + this.gesturePositionChange.y;
    }
    pinchTo(scale, atX, atY, animate = false, center = false, time = defaultEaseTime, easing = defaultEase) {
        console.log("animate", animate, time, easing);
        this.style.transition = animate ? `all ${time}s ` : "none";
        this.style.transitionTimingFunction = easing;
        if (animate)
            this.style.willChange = "transform";
        this.initialCenter = {
            x: atX,
            y: atY
        };
        this._scale = 1;
        this.initialScale = 1;
        this.initialDistance = 100;
        this.translationAtGestureStart.x = 0;
        this.translationAtGestureStart.y = 0;
        this._translation.x = 0;
        this._translation.y = 0;
        this.initialDistance = 100;
        this.pinchDistance = 100 + 100 * (scale - this._scale);
        this.pinchScale = (this.pinchDistance / this.initialDistance);
        let newCenterX = center ? this.untransformedBoundingClientRect.width / 2 : atX;
        let newCenterY = center ? this.untransformedBoundingClientRect.height / 2 : atY;
        this.gesturePositionChange.x = newCenterX - this.initialCenter.x * this.pinchScale;
        this.gesturePositionChange.y = newCenterY - this.initialCenter.y * this.pinchScale;
        let absoluteScale = this.pinchScale * this.initialScale;
        let absoluteOffsetX = this.gesturePositionChange.x + this.translationAtGestureStart.x * this.pinchScale;
        let absoluteOffsetY = this.gesturePositionChange.y + this.translationAtGestureStart.y * this.pinchScale;
        this.setTransform(absoluteOffsetX, absoluteOffsetY, absoluteScale);
        this.origin.x = newCenterX;
        this.origin.y = newCenterY;
        this.initialCenter.x = 0;
        this.initialCenter.y = 0;
        this.initialScale *= this.pinchScale;
        this.translationAtGestureStart.x = this.translationAtGestureStart.x * this.pinchScale + this.gesturePositionChange.x;
        this.translationAtGestureStart.y = this.translationAtGestureStart.y * this.pinchScale + this.gesturePositionChange.y;
    }
    debug() {
        if (this._debugElement)
            return;
        this._debugElement = document.createElement("div");
        this._debugElement.id = "--zoom-panel-debug-" + Math.random();
        this.appendChild(this._debugElement);
        Object.assign(this._debugElement.style, {
            pointerEvents: "none",
            position: "absolute",
            top: "0px",
            left: "0px",
            width: "0px",
            height: "0px",
            overflow: "visible",
            zIndex: "999999999999999",
            backgroundColor: "#00ff0022",
            color: "white",
            fontFamily: "helvetica,Arial,sans-serif",
        });
        const vitals = document.createElement("div");
        this._debugElement.appendChild(vitals);
        Object.assign(vitals.style, {
            pointerEvents: "none",
            position: "absolute",
            display: "flex",
            flexDirection: "column",
            top: "0px",
            left: "0px",
            width: "0px",
            height: "0px",
            overflow: "visible",
            fontSize: "0.8rem",
            transformOrigin: "0 0"
        });
        const canvas = document.createElement("canvas");
        canvas.setAttribute("width", this.untransformedBoundingClientRect.width + "px");
        canvas.setAttribute("height", this.untransformedBoundingClientRect.height + "px");
        this._debugElement.appendChild(canvas);
        Object.assign(canvas.style, {
            pointerEvents: "none",
            position: "absolute",
            top: "0px",
            left: "0px",
            width: this.untransformedBoundingClientRect.width + "px",
            height: this.untransformedBoundingClientRect.height + "px",
            backgroundColor: "transparent",
            outline: "10px solid #00ffff66",
            outlineOffset: "-5px",
            transformOrigin: "0 0"
        });
        const ctx = canvas.getContext("2d");
        console.warn("starting zoom panel debug loop!");
        const debugLoop = () => {
            Object.assign(vitals.style, {
                transform: `translate(${-this.translation.x / this.scale}px, ${-this.translation.y / this.scale}px) scale(${1 / this.scale}) `
            });
            vitals.innerHTML = `
                <div style="background-color:#00000066;width:max-content;">pointers: ${this.pointers.length}</div>
                <div style="background-color:#00000066;width:max-content;">mode: ${this.mode}</div>
                <div style="background-color:#00000066;width:max-content;">target transform: ${this.style.transform}</div>
                <div style="background-color:#00000066;width:max-content;">transition: ${this.style.transition}</div>
                <div style="background-color:#00000066;width:max-content;">Zoom-Panel element client bbox: ${JSON.stringify(this.untransformedBoundingClientRect)}</div>
            `;
            if (canvas.width != this.untransformedBoundingClientRect.width)
                canvas.setAttribute("width", this.untransformedBoundingClientRect.width + "px");
            if (canvas.height != this.untransformedBoundingClientRect.height)
                canvas.setAttribute("height", this.untransformedBoundingClientRect.height + "px");
            Object.assign(canvas.style, {
                transform: `translate(${-this.translation.x / this.scale}px, ${-this.translation.y / this.scale}px) scale(${1 / this.scale}) `
            });
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.lineWidth = 4;
            ctx.strokeStyle = "#00ffff";
            this.pointers.forEach(p => {
                let size = p.pointerType == "touch"
                    ? 100
                    : 20;
                ctx.strokeRect(p.clientX - size / 2, p.clientY - size / 2, size, size);
            });
            window.requestAnimationFrame(debugLoop);
        };
        window.requestAnimationFrame(debugLoop);
        return this._debugElement;
    }
    get center() {
        let p = {
            x: this.untransformedBoundingClientRect.width / 2,
            y: this.untransformedBoundingClientRect.height / 2
        };
        p.x -= this.translation.x;
        p.y -= this.translation.y;
        return {
            x: 0,
            y: 0
        };
    }
    get viewport() {
        let bbox = JSON.parse(JSON.stringify(this.untransformedBoundingClientRect));
        bbox.top = 0;
        bbox.left = 0;
        bbox.left -= this.translation.x / this.scale;
        bbox.top -= this.translation.y / this.scale;
        bbox.width /= this.scale;
        bbox.height /= this.scale;
        return bbox;
    }
    frame(rect, animate = true, roundFactor = 100) {
        if (!isRect(rect)) {
            console.error("frame(rect:Rect,animate = true) rect param must be a Rect! Received", rect);
            return;
        }
        let x = rect.left + rect.width / 2;
        let y = rect.top + rect.height / 2;
        let maxWidthScale = this.untransformedBoundingClientRect.width / rect.width;
        let maxHeightScale = this.untransformedBoundingClientRect.height / rect.height;
        let scale = Math.min(maxWidthScale, maxHeightScale);
        x = Math.floor(x * roundFactor) / roundFactor;
        y = Math.floor(y * roundFactor) / roundFactor;
        scale = Math.floor(scale * roundFactor) / roundFactor;
        this.pinchTo(scale, x, y, animate, true);
    }
    frameChild(el, padding = {
        top: 20,
        right: 20,
        bottom: 20,
        left: 20,
    }, animate = true, roundFactor = 10) {
        if (el == null || el == undefined) {
            console.warn("frameChild(null) no go");
            return;
        }
        const { top, left, width, height } = el.getBoundingClientRect();
        let bbox = { top, left, width, height };
        let currentTranslation = {
            x: this.currentTransform.x,
            y: this.currentTransform.y
        };
        let currentScale = this.currentTransform.scale;
        padding.top = padding.top || 0;
        padding.left = padding.left || 0;
        padding.right = padding.right || 0;
        padding.bottom = padding.bottom || 0;
        bbox.top -= this.untransformedBoundingClientRect.top;
        bbox.left -= this.untransformedBoundingClientRect.left;
        bbox.top -= currentTranslation.y;
        bbox.left -= currentTranslation.x;
        bbox.width /= currentScale;
        bbox.height /= currentScale;
        bbox.top /= currentScale;
        bbox.left /= currentScale;
        bbox.top -= padding.top;
        bbox.left -= padding.left;
        bbox.height += padding.top + padding.bottom;
        bbox.width += padding.left + padding.right;
        this.frame(bbox, animate, roundFactor);
    }
    focusChild(scale, el, animate = true, center = true, time = 0.5, easing = defaultEase) {
        if (el == null || el == undefined) {
            console.warn("frameChild(null) no go");
            return;
        }
        const { top, left, width, height } = el.getBoundingClientRect();
        let bbox = { top, left, width, height };
        let currentTransform = new WebKitCSSMatrix(window.getComputedStyle(this).transform);
        let currentTranslation = {
            x: currentTransform.e,
            y: currentTransform.f
        };
        let currentScale = currentTransform.a;
        bbox.top -= this.untransformedBoundingClientRect.top;
        bbox.left -= this.untransformedBoundingClientRect.left;
        bbox.top -= currentTranslation.y;
        bbox.left -= currentTranslation.x;
        bbox.width /= currentScale;
        bbox.height /= currentScale;
        bbox.top /= currentScale;
        bbox.left /= currentScale;
        let centerOn = {
            x: bbox.left + bbox.height / 2,
            y: bbox.top + bbox.height / 2,
        };
        this.pinchTo(scale, centerOn.x, centerOn.y, animate, center, time, easing);
    }
    clearManipulation() {
        this.mode = "none";
        debugger;
        this.pointers.length = 0;
        this._flushCachedBoundingRect();
        this.dispatchEvent(new CustomEvent("didClearManipulation"));
    }
    clearZoom(duration, ease) {
        if (!this.isTransformed) {
            this.dispatchEvent(new CustomEvent("zoomDidClear"));
            return;
        }
        duration = duration == undefined ? defaultEaseTime * 1000 : duration;
        this._scale = 1;
        this._translation.x = 0;
        this._translation.y = 0;
        this.origin.x = 0;
        this.origin.y = 0;
        this.initialCenter.x = 0;
        this.initialCenter.y = 0;
        this.initialScale = 1;
        this.translationAtGestureStart.x = 0;
        this.translationAtGestureStart.y = 0;
        this.style.willChange = `transform`;
        this.style.transition = `all ${duration}ms`;
        if (ease)
            this.style.transitionTimingFunction = ease;
        this.setTransform(0, 0, 1);
        if (this.clearZoomTimeoutID)
            clearTimeout(this.clearZoomTimeoutID);
        this.clearZoomTimeoutID = setTimeout(() => {
            if (!this.gesturing) {
                this.style.willChange = ``;
                this.clearManipulation();
                this._flushCachedBoundingRect();
            }
            this.dispatchEvent(new CustomEvent("zoomDidClear"));
        }, duration + 50);
    }
}
customElements.define('zoom-panel', ZoomPanel);
export default ZoomPanel;
