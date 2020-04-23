class ZoomPanel extends HTMLElement {
    constructor() {
        super();
        this.pointers = [];
        this.mode = "none";
        this.scale = 1;
        this.origin = { x: 0, y: 0 };
        this.initialCenter = { x: 0, y: 0 };
        this.initialDistance = 0;
        this.initialScale = 1;
        this.initialGesturePosition = { x: 0, y: 0 };
        this.pinchDistance = undefined;
        this.gesturePositionChange = { x: 0, y: 0 };
        this.pinchScale = undefined;
        this._cachedBoundingBox = null;
        this.lastPointTime = undefined;
        this.lastPointPos = { x: 0, y: 0 };
        this.doubleTapTime = 300;
        this.centerOnDoubleTap = false;
        this.mouseWheelTimoutID = undefined;
        this.clearZoomTimeoutID = undefined;
    }
    get gesturing() {
        return this.mode != "none";
    }
    get boundingBox() {
        if (this._cachedBoundingBox == null) {
            this._cachedBoundingBox = this.getBoundingClientRect();
        }
        return this._cachedBoundingBox;
    }
    connectedCallback() {
        this.addEventListener("pointerdown", (e) => {
            this.pointers.push(e);
            if (this.pointers.length == 2 && this.mode == "none") {
                this.gestureWillBegin();
                this.pinchStart(e);
                this.dispatchEvent(new CustomEvent("pinchStart"));
                this.dispatchEvent(new CustomEvent("manipulationStart"));
            }
            else if (this.pointers.length == 2 && this.mode == "pan") {
                this.panEnd(e);
                this.dispatchEvent(new CustomEvent("panEnd"));
                this.pinchStart(e);
                this.dispatchEvent(new CustomEvent("pinchStart"));
            }
            else if (this.pointers.length == 1 && this.mode == "none") {
                let currentTime = new Date().getTime();
                if (this.lastPointTime && (currentTime - this.lastPointTime) < this.doubleTapTime) {
                    this.pointers.length = 0;
                    this.gestureWillBegin();
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
        }, { capture: true });
        this.addEventListener("pointerdown", (e) => {
            if (!this.gesturing && this.pointers.length == 1) {
                e.stopImmediatePropagation();
                this.gestureWillBegin();
                this.panStart(e);
                this.dispatchEvent(new CustomEvent("panStart"));
                this.dispatchEvent(new CustomEvent("manipulationStart"));
            }
        });
        this.addEventListener("pointermove", (e) => {
            for (let i = 0; i < this.pointers.length; i++) {
                if (this.pointers[i].pointerId == e.pointerId)
                    this.pointers[i] = e;
            }
            if (this.pointers.length >= 2 && this.mode == "none") {
                this.gestureWillBegin();
                this.pinchStart(e);
                this.dispatchEvent(new CustomEvent("pinchStart"));
                this.dispatchEvent(new CustomEvent("manipulationStart"));
            }
            else if (this.pointers.length >= 2 && this.mode == "pinch") {
                this.pinchMove(e);
            }
            else if (this.pointers.length >= 2 && this.mode == "pan") {
                this.pinchEnd(e);
                this.dispatchEvent(new CustomEvent("pinchEnd"));
                this.panStart(e);
                this.dispatchEvent(new CustomEvent("panStart"));
            }
            else if (this.pointers.length == 1 && this.mode == "pan") {
                this.panMove(e);
            }
            if (this.gesturing) {
                e.preventDefault();
                e.stopImmediatePropagation();
            }
        }, { capture: true });
        let handlePointerUp = (e) => {
            for (let i = 0; i < this.pointers.length; i++) {
                if (this.pointers[i].pointerId == e.pointerId)
                    this.pointers.splice(i, 1);
            }
            if (this.pointers.length == 0 && this.mode == "pinch") {
                e.preventDefault();
                e.stopImmediatePropagation();
                this.pinchEnd(e);
                this.dispatchEvent(new CustomEvent("pinchEnd"));
                this.gestureEnd(e);
                this.dispatchEvent(new CustomEvent("manipulationEnd"));
            }
            else if (this.pointers.length == 0 && this.mode == "pan") {
                e.preventDefault();
                e.stopImmediatePropagation();
                this.panEnd(e);
                this.dispatchEvent(new CustomEvent("panEnd"));
                this.gestureEnd(e);
                this.dispatchEvent(new CustomEvent("manipulationEnd"));
            }
            else if (this.pointers.length == 1 && this.mode == "pinch") {
                e.preventDefault();
                e.stopImmediatePropagation();
                this.pinchEnd(e);
                this.dispatchEvent(new CustomEvent("pinchEnd"));
                this.panStart(this.pointers[0]);
                this.dispatchEvent(new CustomEvent("panStart"));
            }
        };
        document.addEventListener("pointerup", handlePointerUp, { capture: true });
        this.addEventListener("mousewheel", this.handleMouseWheel.bind(this), { capture: true });
    }
    handleMouseWheel(e) {
        let targetScale = this.scale - e.deltaY / 750;
        this.style.transition = "none";
        this.doPinch(targetScale, e.clientX - this.boundingBox.left, e.clientY - this.boundingBox.top);
        if (this.mouseWheelTimoutID)
            clearTimeout(this.mouseWheelTimoutID);
        else
            this.dispatchEvent(new CustomEvent("manipulationStart"));
        this.mouseWheelTimoutID = setTimeout(() => {
            this.mouseWheelTimoutID = undefined;
            this.gestureEnd();
        }, 300);
    }
    doubleTap(e) {
        if (this.scale > 1)
            this.clearZoom();
        else {
            let x = e.clientX;
            let y = e.clientY;
            this.doPinch(2, x - this.boundingBox.left, y - this.boundingBox.top, true, this.centerOnDoubleTap);
        }
    }
    pinchStart(e) {
        if (this.gesturing)
            return;
        else
            this.mode = "pinch";
        this.style.transition = "none";
        this.initialCenter.x = (this.pointers[1].clientX + this.pointers[0].clientX) / 2 - this.boundingBox.left;
        this.initialCenter.y = (this.pointers[1].clientY + this.pointers[0].clientY) / 2 - this.boundingBox.top;
        let distanceX = (this.pointers[1].clientX - this.pointers[0].clientX);
        let distanceY = (this.pointers[1].clientY - this.pointers[0].clientY);
        this.initialDistance = Math.sqrt(distanceX * distanceX + distanceY * distanceY);
        this.pinchScale = 1;
        this.gesturePositionChange.x = 0;
        this.gesturePositionChange.y = 0;
        this.pinchDistance = this.initialDistance;
    }
    pinchMove(e) {
        let distanceX = (this.pointers[1].clientX - this.pointers[0].clientX);
        let distanceY = (this.pointers[1].clientY - this.pointers[0].clientY);
        this.pinchDistance = Math.sqrt(distanceX * distanceX + distanceY * distanceY);
        this.pinchScale = (this.pinchDistance / this.initialDistance);
        let newCenterX = (this.pointers[1].clientX + this.pointers[0].clientX) / 2 - this.boundingBox.left;
        let newCenterY = (this.pointers[1].clientY + this.pointers[0].clientY) / 2 - this.boundingBox.top;
        this.gesturePositionChange.x = newCenterX - this.initialCenter.x * this.pinchScale;
        this.gesturePositionChange.y = newCenterY - this.initialCenter.y * this.pinchScale;
        let absoluteScale = this.pinchScale * this.initialScale;
        let absoluteOffsetX = this.gesturePositionChange.x + this.initialGesturePosition.x * this.pinchScale;
        let absoluteOffsetY = this.gesturePositionChange.y + this.initialGesturePosition.y * this.pinchScale;
        this.style.transform = `translate(${absoluteOffsetX}px, ${absoluteOffsetY}px) scale(${absoluteScale})`;
        this.style.transformOrigin = `0 0`;
        this.scale = absoluteScale;
        this.origin.x = newCenterX;
        this.origin.y = newCenterY;
    }
    panStart(e) {
        if (this.gesturing)
            return;
        else
            this.mode = "pan";
        this.style.transition = "none";
        let x = e.clientX;
        let y = e.clientY;
        this.initialCenter.x = x - this.boundingBox.left;
        this.initialCenter.y = y - this.boundingBox.top;
        this.pinchScale = 1;
        this.gesturePositionChange.x = 0;
        this.gesturePositionChange.y = 0;
        this.pinchDistance = this.initialDistance;
    }
    panMove(e) {
        this.pinchScale = 1;
        let x = e.clientX;
        let y = e.clientY;
        let newCenterX = x - this.boundingBox.left;
        let newCenterY = y - this.boundingBox.top;
        this.gesturePositionChange.x = newCenterX - this.initialCenter.x * this.pinchScale;
        this.gesturePositionChange.y = newCenterY - this.initialCenter.y * this.pinchScale;
        let absoluteScale = this.pinchScale * this.initialScale;
        let absoluteOffsetX = this.gesturePositionChange.x + this.initialGesturePosition.x * this.pinchScale;
        let absoluteOffsetY = this.gesturePositionChange.y + this.initialGesturePosition.y * this.pinchScale;
        this.style.transform = `translate(${absoluteOffsetX}px, ${absoluteOffsetY}px) scale(${absoluteScale})`;
        this.style.transformOrigin = `0 0`;
        this.scale = absoluteScale;
        this.origin.x = newCenterX;
        this.origin.y = newCenterY;
    }
    panEnd(e) {
        if (!this.gesturing)
            return;
        else
            this.mode = "none";
        this.initialCenter.x = undefined;
        this.initialCenter.y = undefined;
        this.initialScale *= this.pinchScale;
        this.initialGesturePosition.x = this.initialGesturePosition.x * this.pinchScale + this.gesturePositionChange.x;
        this.initialGesturePosition.y = this.initialGesturePosition.y * this.pinchScale + this.gesturePositionChange.y;
        this.pinchDistance = undefined;
        this.gesturePositionChange = { x: 0, y: 0 };
        this.pinchScale = undefined;
    }
    pinchEnd(e) {
        if (!this.gesturing)
            return;
        else
            this.mode = "none";
        this.initialCenter.x = undefined;
        this.initialCenter.y = undefined;
        this.initialScale *= this.pinchScale;
        this.initialGesturePosition.x = this.initialGesturePosition.x * this.pinchScale + this.gesturePositionChange.x;
        this.initialGesturePosition.y = this.initialGesturePosition.y * this.pinchScale + this.gesturePositionChange.y;
        this.pinchDistance = undefined;
        this.gesturePositionChange = { x: 0, y: 0 };
        this.pinchScale = undefined;
    }
    gestureWillBegin(e) {
        if (this.clearZoomTimeoutID)
            clearTimeout(this.clearZoomTimeoutID);
        this.style.willChange = "transform";
    }
    gestureEnd(e) {
        this.mode = "none";
        this.style.willChange = "";
        if (this.scale <= 1) {
            this.clearZoom();
        }
    }
    get zoom() {
        return this.scale;
    }
    get zoomOrigin() {
        return Object.freeze(Object.apply({}, this.origin));
    }
    doPinch(withScale, atX, atY, animate = false, center = false) {
        if (this.gesturing) {
            console.warn("ZoomPanel:: can't set zoom while gesturing");
            return;
        }
        this.style.transition = animate ? "transform 0.65s" : "none";
        this.initialCenter = {
            x: atX,
            y: atY
        };
        this.initialDistance = 100;
        this.pinchDistance = 100 + 100 * (withScale - this.scale);
        this.pinchScale = (this.pinchDistance / this.initialDistance);
        let newCenterX = center ? this.boundingBox.width / 2 : atX;
        let newCenterY = center ? this.boundingBox.height / 2 : atY;
        this.gesturePositionChange.x = newCenterX - this.initialCenter.x * this.pinchScale;
        this.gesturePositionChange.y = newCenterY - this.initialCenter.y * this.pinchScale;
        let absoluteScale = this.pinchScale * this.initialScale;
        let absoluteOffsetX = this.gesturePositionChange.x + this.initialGesturePosition.x * this.pinchScale;
        let absoluteOffsetY = this.gesturePositionChange.y + this.initialGesturePosition.y * this.pinchScale;
        this.style.transform = `translate(${absoluteOffsetX}px, ${absoluteOffsetY}px) scale(${absoluteScale})`;
        this.style.transformOrigin = `0 0`;
        this.scale = absoluteScale;
        this.origin.x = newCenterX;
        this.origin.y = newCenterY;
        this.initialCenter.x = 0;
        this.initialCenter.y = 0;
        this.initialScale *= this.pinchScale;
        this.initialGesturePosition.x = this.initialGesturePosition.x * this.pinchScale + this.gesturePositionChange.x;
        this.initialGesturePosition.y = this.initialGesturePosition.y * this.pinchScale + this.gesturePositionChange.y;
    }
    pinchTo(scale, atX, atY, animate = false, center = false) {
        this.style.transition = animate ? "transform 0.65s" : "none";
        this.initialCenter = {
            x: atX,
            y: atY
        };
        this.scale = 1;
        this.initialScale = 1;
        this.initialDistance = 100;
        this.initialGesturePosition.x = 0;
        this.initialGesturePosition.y = 0;
        this.initialDistance = 100;
        this.pinchDistance = 100 + 100 * (scale - this.scale);
        this.pinchScale = (this.pinchDistance / this.initialDistance);
        let newCenterX = center ? this.boundingBox.width / 2 : atX;
        let newCenterY = center ? this.boundingBox.height / 2 : atY;
        this.gesturePositionChange.x = newCenterX - this.initialCenter.x * this.pinchScale;
        this.gesturePositionChange.y = newCenterY - this.initialCenter.y * this.pinchScale;
        let absoluteScale = this.pinchScale * this.initialScale;
        let absoluteOffsetX = this.gesturePositionChange.x + this.initialGesturePosition.x * this.pinchScale;
        let absoluteOffsetY = this.gesturePositionChange.y + this.initialGesturePosition.y * this.pinchScale;
        this.style.transform = `translate(${absoluteOffsetX}px, ${absoluteOffsetY}px) scale(${absoluteScale})`;
        this.style.transformOrigin = `0 0`;
        this.scale = absoluteScale;
        this.origin.x = newCenterX;
        this.origin.y = newCenterY;
        this.initialCenter.x = 0;
        this.initialCenter.y = 0;
        this.initialScale *= this.pinchScale;
        this.initialGesturePosition.x = this.initialGesturePosition.x * this.pinchScale + this.gesturePositionChange.x;
        this.initialGesturePosition.y = this.initialGesturePosition.y * this.pinchScale + this.gesturePositionChange.y;
    }
    frame(rect) {
        let x = rect.left + rect.width / 2;
        let y = rect.top + rect.height / 2;
        let maxWidthScale = this.boundingBox.width / rect.width;
        let maxHeightScale = this.boundingBox.height / rect.height;
        let scale = Math.min(maxWidthScale, maxHeightScale);
        this.pinchTo(scale, x, y, true, true);
    }
    clearZoom() {
        this.pointers.length = 0;
        this.scale = 1;
        this.origin.x = 0;
        this.origin.y = 0;
        this.initialCenter.x = 0;
        this.initialCenter.y = 0;
        this.initialScale = 1;
        this.initialGesturePosition.x = 0;
        this.initialGesturePosition.y = 0;
        this.style.willChange = `transform`;
        this.style.transform = `translate(0px, 0px) scale(1)`;
        this.style.transformOrigin = `0 0`;
        this.style.transition = "transform 0.65s";
        if (this.clearZoomTimeoutID)
            clearTimeout(this.clearZoomTimeoutID);
        this.clearZoomTimeoutID = setTimeout(() => {
            if (!this.gesturing)
                this.style.willChange = ``;
            this.dispatchEvent(new CustomEvent("zoomDidClear"));
        }, 700);
    }
}
customElements.define('zoom-panel', ZoomPanel);
export default ZoomPanel;
