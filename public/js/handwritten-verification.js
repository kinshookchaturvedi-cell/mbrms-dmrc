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

        if (typeof Tesseract === 'undefined') {
            console.error("HandwrittenOCR Error: Tesseract.js library is not loaded.");
            return { extractedText: '', confidence: 0, isHandwritten: false };
        }

        try {
            let processedImage = imageSource;

            // 1. OpenCV Preprocessing (Optimal)
            if (window.cv && imageSource instanceof HTMLCanvasElement) {
                processedImage = this.preprocessCanvasWithOpenCV(imageSource);
            } 
            // 2. Pure JS Fallback Preprocessing if OpenCV is absent
            else if (imageSource instanceof HTMLCanvasElement) {
                processedImage = this.preprocessCanvasFallback(imageSource);
            }

            // Run Tesseract with custom parameters optimized for handwriting/single blocks
            const worker = await Tesseract.createWorker('eng');
            
            await worker.setParameters({
                tessedit_char_whitelist: '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz/.-,() ',
                tessedit_pageseg_mode: Tesseract.PSM.SPARSE_TEXT, // Works better for scattered handwritten text
            });

            const { data: { text, confidence } } = await worker.recognize(processedImage);
            await worker.terminate();

            return {
                extractedText: text || '',
                confidence: confidence || 0,
                isHandwritten: true
            };

        } catch (error) {
            console.error("HandwrittenOCR Execution Error:", error);
            return { extractedText: '', confidence: 0, isHandwritten: false };
        }
    },

    /**
     * Advanced binarization using OpenCV.js (Otsu Thresholding)
     */
    preprocessCanvasWithOpenCV(canvas) {
        let src = cv.imread(canvas);
        let dst = new cv.Mat();
        
        cv.cvtColor(src, src, cv.COLOR_RGBA2GRAY, 0);
        cv.threshold(src, dst, 0, 255, cv.THRESH_BINARY + cv.THRESH_OTSU);
        
        let outputCanvas = document.createElement('canvas');
        cv.imshow(outputCanvas, dst);
        
        // Deallocate OpenCV C++ memory
        src.delete();
        dst.delete();
        
        return outputCanvas;
    },

    /**
     * Lightweight Canvas Binarization Fallback (Used when OpenCV.js is not loaded)
     */
    preprocessCanvasFallback(canvas) {
        const ctx = canvas.getContext('2d');
        if (!ctx) return canvas;

        const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imgData.data;

        for (let i = 0; i < data.length; i += 4) {
            const avg = (data[i] + data[i + 1] + data[i + 2]) / 3;
            const threshold = avg < 140 ? 0 : 255;
            data[i] = data[i + 1] = data[i + 2] = threshold;
        }

        const outputCanvas = document.createElement('canvas');
        outputCanvas.width = canvas.width;
        outputCanvas.height = canvas.height;
        outputCanvas.getContext('2d').putImageData(imgData, 0, 0);

        return outputCanvas;
    }
};