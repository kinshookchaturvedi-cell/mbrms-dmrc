/**
 * public/js/handwritten-verification.js
 * Specialized module for preprocessing and recognizing handwritten text
 */

window.HandwrittenOCR = {
    /**
     * Process an image canvas or file for handwriting extraction
     */
    async processHandwrittenDoc(imageSource) {
        console.log("Initiating handwritten document processing...");

        // Optional: Pre-process canvas with contrast enhancement if OpenCV.js is loaded
        let processedImage = imageSource;
        if (window.cv) {
            processedImage = this.preprocessCanvasWithOpenCV(imageSource);
        }

        // Run Tesseract with custom parameters optimized for handwriting/single blocks
        const worker = await Tesseract.createWorker('eng');
        await worker.setParameters({
            tessedit_char_whitelist: '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz/.- ',
            tessedit_pageseg_mode: Tesseract.PSM.SPARSE_TEXT, // Works better for scattered handwritten text
        });

        const { data: { text, confidence } } = await worker.recognize(processedImage);
        await worker.terminate();

        return {
            extractedText: text,
            confidence: confidence,
            isHandwritten: true
        };
    },

    preprocessCanvasWithOpenCV(canvas) {
        // Simple thresholding to clean up handwritten document backgrounds
        let src = cv.imread(canvas);
        let dst = new cv.Mat();
        cv.cvtColor(src, src, cv.COLOR_RGBA2GRAY, 0);
        cv.threshold(src, dst, 0, 255, cv.THRESH_BINARY + cv.THRESH_OTSU);
        
        let outputCanvas = document.createElement('canvas');
        cv.imshow(outputCanvas, dst);
        src.delete(); 
        dst.delete();
        return outputCanvas;
    }
};
