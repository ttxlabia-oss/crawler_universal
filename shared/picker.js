/**
 * 🎨 Enhanced Element Picker
 * This script is injected into the target page to capture selectors and metadata.
 */

(function() {
    let lastElement = null;
    let isActive = true;

    // 1. Create a highlighter overlay
    const overlay = document.createElement('div');
    overlay.id = 'scraper-highlighter-overlay';
    overlay.style.position = 'absolute';
    overlay.style.border = '2px solid #ef4444'; // Red for visibility
    overlay.style.backgroundColor = 'rgba(239, 68, 68, 0.1)';
    overlay.style.pointerEvents = 'none';
    overlay.style.zIndex = '2147483647';
    overlay.style.transition = 'all 0.05s ease';
    document.body.appendChild(overlay);

    // 2. Track mouse movement
    document.addEventListener('mouseover', (e) => {
        if (!isActive) return;
        const target = e.target;
        if (target === overlay || target.id === 'scraper-highlighter-overlay') return;
        
        lastElement = target;
        const rect = target.getBoundingClientRect();
        
        overlay.style.top = `${rect.top + window.scrollY}px`;
        overlay.style.left = `${rect.left + window.scrollX}px`;
        overlay.style.width = `${rect.width}px`;
        overlay.style.height = `${rect.height}px`;
    });

    // 3. Handle click - Capture detailed payload
    document.addEventListener('click', (e) => {
        if (!isActive) return;
        e.preventDefault();
        e.stopPropagation();

        if (lastElement) {
            const payload = {
                type: 'ELEMENT_SELECTED',
                timestamp: Date.now(),
                data: {
                    tagName: lastElement.tagName.toLowerCase(),
                    text: lastElement.innerText.trim().substring(0, 100),
                    href: lastElement.href || lastElement.closest('a')?.href,
                    src: lastElement.src,
                    className: lastElement.className,
                    id: lastElement.id,
                    selectors: {
                        css: getUniqueSelector(lastElement),
                        xpath: getXPath(lastElement)
                    }
                }
            };
            
            console.log("🎯 Element Picked:", payload);
            window.parent.postMessage(payload, '*');
        }
    }, true);

    // 🏆 Helper: Unique CSS Selector
    function getUniqueSelector(el) {
        if (el.id) return `#${el.id}`;
        let path = [];
        while (el && el.nodeType === Node.ELEMENT_NODE) {
            let selector = el.nodeName.toLowerCase();
            if (el.id) {
                selector += '#' + el.id;
                path.unshift(selector);
                break;
            } else {
                let sib = el, nth = 1;
                while (sib = sib.previousElementSibling) {
                    if (sib.nodeName.toLowerCase() == selector) nth++;
                }
                if (nth != 1) selector += ":nth-of-type("+nth+")";
            }
            path.unshift(selector);
            el = el.parentNode;
        }
        return path.join(" > ");
    }

    // 🏆 Helper: XPath
    function getXPath(element) {
        if (element.id !== '') return '//*[@id="' + element.id + '"]';
        if (element === document.body) return '/html/body';

        let ix = 0;
        let siblings = element.parentNode.childNodes;
        for (let i = 0; i < siblings.length; i++) {
            let sibling = siblings[i];
            if (sibling === element) return getXPath(element.parentNode) + '/' + element.tagName.toLowerCase() + '[' + (ix + 1) + ']';
            if (sibling.nodeType === 1 && sibling.tagName === element.tagName) ix++;
        }
    }

    window.addEventListener('message', (event) => {
        if (event.data.type === 'SET_PICKER_STATUS') {
            isActive = event.data.active;
            overlay.style.display = isActive ? 'block' : 'none';
        }
    });

    console.log("🚀 Enhanced Picker Ready");
})();
