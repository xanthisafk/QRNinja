document.addEventListener('DOMContentLoaded', () => {
    const DEFAULT_QR_TEXT = 'https://qrninja.xanthis.xyz';
    const LS_PREFIX = 'qrninja_';

    // DOM Elements
    const generatorElements = {
        text: document.getElementById('qr-text'),
        charCounter: document.getElementById('char-counter'),
        dotsColor: document.getElementById('qr-dots-color'),
        bgColor: document.getElementById('qr-bg-color'),
        dotsStyle: document.getElementById('qr-dots-style'),
        errorCorrection: document.getElementById('qr-error-correction'),
        logoInput: document.getElementById('qr-logo'),
        clearLogoBtn: document.getElementById('clear-logo-btn'),
        resetBtn: document.getElementById('reset-btn'),
        saveBtn: document.getElementById('save-btn'),
        saveOptions: document.querySelectorAll('.save-option'),
        canvasContainer: document.getElementById('qr-canvas-container'),
        qrCanvas: document.getElementById('qr-canvas'),
        settingsDropZone: document.getElementById('generate-settings')
    };

    const readerElements = {
        fileInput: document.getElementById('read-file'),
        canvasContainer: document.getElementById('reader-canvas-container'),
        canvas: document.getElementById('reader-canvas'),
        cropOverlay: document.getElementById('crop-overlay'),
        placeholder: document.getElementById('reader-placeholder'),
        resultContainer: document.getElementById('reader-result-container'),
        resultText: document.getElementById('reader-result-text'),
        warning: document.getElementById('reader-warning'),
        dropZone: document.getElementById('reader-preview'),
        // Camera
        startCameraBtn: document.getElementById('start-camera-btn'),
        stopCameraBtn: document.getElementById('stop-camera-btn'),
        cameraFeed: document.getElementById('camera-feed'),
    };

    const tabLinks = document.querySelectorAll('.tab-link');
    const tabContents = document.querySelectorAll('.tab-content');
    const themeToggle = document.getElementById('theme-toggle');

    let logoBase64 = null;
    let qrCode;
    let readerImage = null;
    let cropRect = null;
    let isDragging = false;

    // Camera state
    let cameraStream = null;
    let animationFrameId = null;

    // Util
    const ls = {
        get: (key, fallback) => localStorage.getItem(LS_PREFIX + key) || fallback,
        set: (key, value) => localStorage.setItem(LS_PREFIX + key, value),
        remove: (key) => localStorage.removeItem(LS_PREFIX + key)
    };

    const showConfirm = (message, callback) => {
        const dialog = document.getElementById('confirm-dialog');
        const messageEl = document.getElementById('confirm-message');
        const okBtn = document.getElementById('confirm-ok');
        const cancelBtn = document.getElementById('confirm-cancel');
        const closeBtn = dialog.querySelector('.close');

        messageEl.textContent = message;

        const controller = new AbortController();
        const { signal } = controller;

        const closeDialog = (result) => {
            dialog.close();
            callback(result);
            controller.abort();
        };

        okBtn.addEventListener('click', () => closeDialog(true), { signal });
        cancelBtn.addEventListener('click', () => closeDialog(false), { signal });
        closeBtn.addEventListener('click', (e) => { e.preventDefault(); closeDialog(false); }, { signal });

        dialog.showModal();
    };

    // Theme
    const applyTheme = (theme) => {
        document.documentElement.setAttribute('data-theme', theme);
        themeToggle.innerHTML = theme === 'dark' ? '☀️' : '🌙';
        ls.set('theme', theme);
    };

    const toggleTheme = () => {
        const currentTheme = ls.get('theme', 'light');
        const newTheme = currentTheme === 'light' ? 'dark' : 'light';
        applyTheme(newTheme);
    };

    // Generator - https://youtu.be/ZX83_kg_n5c
    const getQRCodeOptions = () => {
        const containerSize = generatorElements.canvasContainer.clientWidth - 40;
        const size = Math.max(200, containerSize);

        return {
            width: size, height: size, type: 'canvas',
            data: ls.get('text', DEFAULT_QR_TEXT),
            image: logoBase64,
            dotsOptions: { color: ls.get('dots-color', '#000000'), type: ls.get('dots-style', 'square') },
            backgroundOptions: { color: ls.get('bg-color', '#ffffff') },
            imageOptions: { imageSize: 0.4, margin: 5 },
            qrOptions: { errorCorrectionLevel: ls.get('error-correction', 'H') },
        };
    };

    const createOrUpdateQRCode = () => {
        const options = getQRCodeOptions();
        if (!qrCode) {
            qrCode = new QRCodeStyling(options);
            qrCode.append(generatorElements.qrCanvas);
        } else {
            qrCode.update(options);
        }
    };

    const loadGeneratorSettings = () => {
        generatorElements.text.value = ls.get('text', DEFAULT_QR_TEXT);
        generatorElements.dotsColor.value = ls.get('dots-color', '#000000');
        generatorElements.bgColor.value = ls.get('bg-color', '#ffffff');
        generatorElements.dotsStyle.value = ls.get('dots-style', 'square');
        generatorElements.errorCorrection.value = ls.get('error-correction', 'H');
        logoBase64 = ls.get('logo', null);
        if (logoBase64) {
            generatorElements.clearLogoBtn.style.display = 'block';
        }
        updateCharCounter();
    };

    const handleGeneratorInputChange = (e) => {
        const el = e.target;
        const key = el.id.replace('qr-', '');
        ls.set(key, el.value);
        if (el.id === 'qr-text') updateCharCounter();
        createOrUpdateQRCode();
    };

    const updateCharCounter = () => {
        const len = generatorElements.text.value.length;
        generatorElements.charCounter.textContent = `${len} / 2953`;
    };

    const resetGeneratorSettings = () => {
        showConfirm("Are you sure you want to reset all generator settings?", (confirmed) => {
            if (!confirmed) return;

            const keysToRemove = ['text', 'dots-color', 'bg-color', 'dots-style', 'error-correction', 'logo'];
            keysToRemove.forEach(key => ls.remove(key));

            logoBase64 = null;
            generatorElements.logoInput.value = '';
            generatorElements.clearLogoBtn.style.display = 'none';
            loadGeneratorSettings();
            createOrUpdateQRCode();
        });
    };

    const handleLogoUpload = (file) => {
        if (!file || !file.type.startsWith('image/')) return;
        const reader = new FileReader();
        reader.onload = () => {
            logoBase64 = reader.result;
            ls.set('logo', logoBase64);
            generatorElements.clearLogoBtn.style.display = 'block';
            createOrUpdateQRCode();
        };
        reader.readAsDataURL(file);
    };

    const clearLogo = () => {
        logoBase64 = null;
        ls.remove('logo');
        generatorElements.logoInput.value = '';
        generatorElements.clearLogoBtn.style.display = 'none';
        createOrUpdateQRCode();
    };

    const handleSave = (type) => {
        qrCode.download({ name: 'qrninja-code', extension: type });
    };

    // Reader
    const scanQRCode = (imageData, width, height) => {
        const code = jsQR(imageData, width, height, { inversionAttempts: "dontInvert" });

        if (code) {
            // If we're scanning via camera, stop it to show the result clearly
            if (cameraStream) stopCamera();

            readerElements.resultContainer.style.display = 'block';
            readerElements.warning.style.display = 'none';
            const resultText = code.data;
            try {
                const url = new URL(resultText);
                readerElements.resultText.innerHTML = '';
                const link = document.createElement('a');
                link.href = url.href;
                link.target = '_blank';
                link.rel = 'noopener noreferrer';
                link.textContent = url.href;
                readerElements.resultText.appendChild(link);
                readerElements.warning.style.display = 'block';
            } catch (_) {
                readerElements.resultText.textContent = resultText;
            }
        } else if (!cameraStream) { // Only show 'not found' for file uploads/crops
            readerElements.resultContainer.style.display = 'block';
            readerElements.resultText.textContent = "No QR code found in the image or selected area.";
        }
    };

    const handleReaderUpload = (file) => {
        if (!file || !file.type.startsWith('image/')) return;
        if (cameraStream) stopCamera();

        readerImage = new Image();
        readerImage.onload = () => {
            readerElements.placeholder.style.display = 'none';
            readerElements.cameraFeed.style.display = 'none';
            readerElements.canvasContainer.style.display = 'block';

            const containerWidth = readerElements.dropZone.clientWidth;
            const scale = Math.min(1, containerWidth / readerImage.width);
            const displayWidth = readerImage.width * scale;
            const displayHeight = readerImage.height * scale;

            readerElements.dropZone.style.height = `${displayHeight}px`;
            [readerElements.canvas, readerElements.cropOverlay].forEach(c => {
                c.width = displayWidth; c.height = displayHeight;
            });

            const ctx = readerElements.canvas.getContext('2d');
            ctx.drawImage(readerImage, 0, 0, displayWidth, displayHeight);
            const imageData = ctx.getImageData(0, 0, displayWidth, displayHeight);
            scanQRCode(imageData.data, imageData.width, imageData.height);
        };
        readerImage.src = URL.createObjectURL(file);
        readerElements.fileInput.value = '';
    };

    const startCamera = async () => {
        readerElements.startCameraBtn.setAttribute('aria-busy', 'true');
        readerElements.startCameraBtn.disabled = true;

        try {
            cameraStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
            readerElements.cameraFeed.srcObject = cameraStream;
            readerElements.cameraFeed.onloadedmetadata = () => {
                readerElements.cameraFeed.play();
                readerElements.placeholder.style.display = 'none';
                readerElements.canvasContainer.style.display = 'none';
                readerElements.cameraFeed.style.display = 'block';
                readerElements.stopCameraBtn.style.display = 'block';

                readerElements.canvas.width = readerElements.cameraFeed.videoWidth;
                readerElements.canvas.height = readerElements.cameraFeed.videoHeight;

                animationFrameId = requestAnimationFrame(tick);
            };
        } catch (err) {
            console.error("Camera Error:", err);
            alert("Could not access the camera.");
            stopCamera();
        } finally {
            readerElements.startCameraBtn.setAttribute('aria-busy', 'false');
            readerElements.startCameraBtn.disabled = false;
        }
    };

    const stopCamera = () => {
        if (animationFrameId) cancelAnimationFrame(animationFrameId);
        if (cameraStream) {
            cameraStream.getTracks().forEach(track => track.stop());
        }
        cameraStream = null;
        readerElements.cameraFeed.srcObject = null;
        readerElements.cameraFeed.style.display = 'none';
        readerElements.stopCameraBtn.style.display = 'none';
        readerElements.placeholder.style.display = 'flex';
        readerElements.dropZone.style.height = ''; // Reset height
    };

    const tick = () => {
        if (readerElements.cameraFeed.readyState === readerElements.cameraFeed.HAVE_ENOUGH_DATA) {
            const ctx = readerElements.canvas.getContext('2d');
            ctx.drawImage(readerElements.cameraFeed, 0, 0, readerElements.canvas.width, readerElements.canvas.height);
            const imageData = ctx.getImageData(0, 0, readerElements.canvas.width, readerElements.canvas.height);
            scanQRCode(imageData.data, imageData.width, imageData.height);
        }
        // Continue scanning as long as the stream is active
        if (cameraStream) {
            animationFrameId = requestAnimationFrame(tick);
        }
    };


    // Drag n Drop
    const setupDragAndDrop = (dropZone, onDrop) => {
        dropZone.addEventListener('dragover', (e) => {
            e.preventDefault(); e.stopPropagation();
            if (!cameraStream) dropZone.classList.add('drag-over');
        });
        dropZone.addEventListener('dragleave', (e) => {
            e.preventDefault(); e.stopPropagation();
            dropZone.classList.remove('drag-over');
        });
        dropZone.addEventListener('drop', (e) => {
            e.preventDefault(); e.stopPropagation();
            if (cameraStream) return; // Don't allow drop when camera is on
            dropZone.classList.remove('drag-over');
            const file = e.dataTransfer.files[0];
            onDrop(file);
        });
    };

    // Event Listeners & Initialization
    const init = () => {
        // Theme
        applyTheme(ls.get('theme', 'light'));
        themeToggle.addEventListener('click', toggleTheme);

        // Tabs
        tabLinks.forEach(link => {
            link.addEventListener('click', e => {
                e.preventDefault();
                const targetTab = e.target.dataset.tab;
                if (targetTab === 'generate' && cameraStream) stopCamera(); // Stop camera if switching tabs

                tabLinks.forEach(l => l.classList.remove('active'));
                e.target.classList.add('active');
                tabContents.forEach(content => content.classList.toggle('active', content.id === targetTab));

                if (targetTab === 'generate') {
                    setTimeout(createOrUpdateQRCode, 50);
                }
            });
        });

        // Generator 
        loadGeneratorSettings();
        createOrUpdateQRCode();
        ['input', 'change'].forEach(evt => {
            [generatorElements.text, generatorElements.dotsColor, generatorElements.bgColor, generatorElements.dotsStyle, generatorElements.errorCorrection].forEach(el => {
                el.addEventListener(evt, handleGeneratorInputChange);
            });
        });
        generatorElements.logoInput.addEventListener('change', (e) => handleLogoUpload(e.target.files[0]));
        generatorElements.clearLogoBtn.addEventListener('click', clearLogo);
        generatorElements.resetBtn.addEventListener('click', resetGeneratorSettings);
        generatorElements.saveOptions.forEach(opt => opt.addEventListener('click', (e) => { e.preventDefault(); handleSave(e.target.dataset.type); }));
        setupDragAndDrop(generatorElements.settingsDropZone, handleLogoUpload);
        new ResizeObserver(createOrUpdateQRCode).observe(generatorElements.canvasContainer);

        // Reader
        readerElements.fileInput.addEventListener('change', (e) => handleReaderUpload(e.target.files[0]));
        readerElements.startCameraBtn.addEventListener('click', startCamera);
        readerElements.stopCameraBtn.addEventListener('click', stopCamera);
        setupDragAndDrop(readerElements.dropZone, handleReaderUpload);

        // Default text
        if (!ls.get('text')) {
            ls.set('text', DEFAULT_QR_TEXT);
            generatorElements.text.value = DEFAULT_QR_TEXT;
            createOrUpdateQRCode();
        }
    };

    init();
});