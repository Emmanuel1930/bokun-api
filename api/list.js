(function() {
    // --- CONFIGURATION ---
    const API_URL = 'https://bokun-api.vercel.app/api/list';
    const CONTAINER_ID = 'bokun-grid-wrapper';
    
    // Smart Pricing Config
    const PRICING_CONFIG = {
        LOCATION_API: 'https://ipwho.is/',
        RATES_API: 'https://open.er-api.com/v6/latest/AED',
        CACHE_KEY: 'bokun_smart_rates_v3', 
        CACHE_DURATION: 3 * 60 * 60 * 1000 // 3 Hours
    };

    // --- 0. AUTO-LOAD ICONS ---
    function loadIcons() {
        if (!document.getElementById('fa-icons-loader')) {
            const link = document.createElement('link');
            link.id = 'fa-icons-loader';
            link.rel = 'stylesheet';
            link.href = 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css';
            document.head.appendChild(link);
        }
    }
    loadIcons(); 

    // --- DOM ELEMENTS ---
    const container = document.getElementById(CONTAINER_ID);
    const loader = document.getElementById('bokun-loader');
    const errorMsg = document.getElementById('bokun-error');
    
    // Read Duda Toggles
    const configDiv = document.getElementById('bokun-config');
    const showGroup = configDiv ? configDiv.getAttribute('data-show-group') === 'true' : false;
    const showPrivate = configDiv ? configDiv.getAttribute('data-show-private') === 'true' : false;
    const showUpcoming = configDiv ? configDiv.getAttribute('data-show-upcoming') === 'true' : false;

    // --- MAIN INITIALIZATION ---
    async function init() {
        try {
            let mode = 'standard';
            if (showUpcoming) mode = 'upcoming';

            const fetchUrl = mode === 'upcoming' ? `${API_URL}?mode=upcoming` : API_URL;
            const response = await fetch(fetchUrl);
            if (!response.ok) throw new Error('API Error');
            const data = await response.json();

            if (loader) loader.style.display = 'none';
            container.innerHTML = ''; 
            
            if (mode === 'upcoming') {
                renderUpcoming(data);
            } else {
                renderStandard(data);
            }

            initSmartPricing();

        } catch (err) {
            console.error(err);
            if (loader) loader.style.display = 'none';
            if (errorMsg) errorMsg.style.display = 'block';
            container.innerHTML = '<p style="text-align:center; color:#888;">Unable to load experiences.</p>';
        }
    }

    // --- HELPER: DEEP SEARCH COLLECTOR ---
    // Hunts for products in any nested folder structure
    function collectAllProducts(node) {
        let results = [];
        
        // 1. If it's a folder with children, dig deeper
        if (node.children && node.children.length > 0) {
            node.children.forEach(child => {
                results = results.concat(collectAllProducts(child));
            });
        } 
        // 2. If it's a product (has ID, but no children array), grab it
        else if (node.id && (!node.children || node.children.length === 0)) {
            // Safety check: Ensure it has a title so we don't grab empty junk
            const p = node.activity || node;
            if (p.title) {
                results.push(node);
            }
        }
        return results;
    }

    // --- RENDER STANDARD (Recursive & Robust) ---
    function renderStandard(data) {
        const activeTours = data.find(n => n.title === "Active Tours");
        if (!activeTours) return;

        let targetFolder = null;
        if (showGroup) targetFolder = activeTours.children.find(n => n.title === "Group Tours");
        else if (showPrivate) targetFolder = activeTours.children.find(n => n.title === "Private Tours");

        if (!targetFolder || !targetFolder.children) {
            container.innerHTML = '<p style="text-align:center;">No tours found.</p>';
            return;
        }

        // Iterate through top-level folders (UAE, Oman, Saudi Arabia...)
        targetFolder.children.forEach(sectionNode => {
            
            // Collect EVERYTHING inside this section (even if nested deeper)
            const allProducts = collectAllProducts(sectionNode);

            if (allProducts.length > 0) {
                // Create Header (e.g. "Saudi Arabia")
                const section = document.createElement('div');
                section.innerHTML = `<h2 class="bokun-section-title">${sectionNode.title}</h2>`;
                
                // Create Grid
                const grid = document.createElement('div');
                grid.className = 'bokun-grid';

                allProducts.forEach(item => {
                    const productData = item.activity || item;
                    // Double check we aren't rendering a folder as a card
                    if (productData.title && !productData.children) {
                        grid.appendChild(createCard(productData, false)); 
                    }
                });

                container.appendChild(section);
                container.appendChild(grid);
            }
        });
    }

    // --- RENDER UPCOMING ---
    function renderUpcoming(products) {
        if (!products || products.length === 0) {
            container.innerHTML = '<p style="text-align:center;">No upcoming dates found.</p>';
            return;
        }

        const grouped = {};
        products.forEach(item => {
            if (!item.startDate) return;
            const dateObj = new Date(item.startDate);
            const monthKey = dateObj.toLocaleString('default', { month: 'long', year: 'numeric' });
            if (!grouped[monthKey]) grouped[monthKey] = [];
            grouped[monthKey].push(item);
        });

        Object.keys(grouped).forEach(monthName => {
            const section = document.createElement('div');
            section.innerHTML = `<h2 class="bokun-section-title">${monthName}</h2>`;
            const grid = document.createElement('div');
            grid.className = 'bokun-grid';
            grouped[monthName].forEach(product => {
                grid.appendChild(createCard(product, true)); 
            });
            container.appendChild(section);
            container.appendChild(grid);
        });
    }

    // --- CARD BUILDER ---
    function createCard(inputData, isUpcoming = false) {
        const p = inputData.activity || inputData;
        const card = document.createElement('div');
        card.className = 'bokun-card';
        
        const slug = p.title.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
        card.onclick = () => window.location.href = `/tour/${slug}`;

        // BADGE LOGIC
        let badgeHTML = '';

        // Upcoming Mode: Date Badge
        if (isUpcoming && inputData.startDate && inputData.endDate) {
            const start = new Date(inputData.startDate);
            const end = new Date(inputData.endDate);
            const startMonth = start.toLocaleString('default', { month: 'short' }).toUpperCase();
            const startDay = start.getDate();
            const endMonth = end.toLocaleString('default', { month: 'short' }).toUpperCase();
            const endDay = end.getDate();

            let badgeContent = '';
            if (start.getTime() === end.getTime()) {
                 badgeContent = `<div class="badge-col"><span class="badge-mo">${startMonth}</span><span class="badge-da">${startDay}</span></div>`;
            } else if (startMonth === endMonth) {
                badgeContent = `<div class="badge-col"><span class="badge-mo">${startMonth}</span><div class="badge-row"><span class="badge-da">${startDay}</span><span class="badge-sep">-</span><span class="badge-da">${endDay}</span></div></div>`;
            } else {
                badgeContent = `<div class="badge-row-split"><div class="badge-col"><span class="badge-mo">${startMonth}</span><span class="badge-da">${startDay}</span></div><span class="badge-sep-lg">-</span><div class="badge-col"><span class="badge-mo">${endMonth}</span><span class="badge-da">${endDay}</span></div></div>`;
            }
            badgeHTML = `<div class="date-badge-smart">${badgeContent}</div>`;
        }
        
        // Standard Mode: Duration Badge
        else if (!isUpcoming) {
            let num = 0; let unit = '';
            if (p.durationWeeks) { num = p.durationWeeks; unit = 'WEEKS'; }
            else if (p.durationDays) { num = p.durationDays; unit = 'DAYS'; }
            else if (p.durationHours) { num = p.durationHours; unit = 'HOURS'; }
            
            if (num > 0) {
                if (num === 1) unit = unit.slice(0, -1);
                badgeHTML = `
                <div class="date-badge-smart">
                    <div class="badge-col">
                        <span class="badge-da" style="font-size: 1.5rem;">${num}</span>
                        <span class="badge-mo" style="font-size: 0.7rem; letter-spacing: 0.5px;">${unit}</span>
                    </div>
                </div>`;
            }
        }

        const imgUrl = (p.keyPhoto && p.keyPhoto.originalUrl) ? p.keyPhoto.originalUrl : 'https://via.placeholder.com/600x400';
        const price = p.nextDefaultPriceMoney ? p.nextDefaultPriceMoney.amount : 'Check Price'; 

        // LOCATION LOGIC
        let locationText = '';
        if (p.googlePlace && p.googlePlace.name) {
            locationText = p.googlePlace.name;
        } else if (p.googlePlace && p.googlePlace.city) {
            locationText = `${p.googlePlace.city}, ${p.googlePlace.country}`;
        } else if (p.locationCode && p.locationCode.location) {
             locationText = `${p.locationCode.location}`;
        }
        
        let locationHTML = '';
        if (locationText) {
            locationHTML = `<div class="card-location"><i class="fa-solid fa-location-dot"></i> ${locationText}</div>`;
        }

        card.innerHTML = `
            ${badgeHTML}
            <div class="card-image-wrapper">
                <img src="${imgUrl}" class="card-image" loading="lazy">
            </div>
            <div class="card-content">
                <div>
                    <h3 class="card-title">${p.title}</h3>
                    ${locationHTML}
                    <div class="card-price-label">From <span class="card-price-value loading" data-base-aed="${price}">${price} AED</span></div>
                </div>
                <button class="view-trip-btn">View Trip</button>
            </div>
        `;

        return card;
    }

    // --- SMART PRICING ---
    async function initSmartPricing() {
        const cached = localStorage.getItem(PRICING_CONFIG.CACHE_KEY);
        if (cached && (Date.now() - JSON.parse(cached).timestamp < PRICING_CONFIG.CACHE_DURATION)) {
            updatePrices(JSON.parse(cached).currency, JSON.parse(cached).rates); return;
        }
        try {
            const loc = await (await fetch(PRICING_CONFIG.LOCATION_API)).json();
            const rates = await (await fetch(PRICING_CONFIG.RATES_API)).json();
            let cur = 'AED';
            const map = {'US':'USD','GB':'GBP','EU':'EUR','DE':'EUR','FR':'EUR','IT':'EUR','SA':'SAR','QA':'QAR'};
            if (map[loc.country_code]) cur = map[loc.country_code];
            localStorage.setItem(PRICING_CONFIG.CACHE_KEY, JSON.stringify({ currency: cur, rates: rates.rates, timestamp: Date.now() }));
            updatePrices(cur, rates.rates);
        } catch (e) { document.querySelectorAll('.card-price-value').forEach(el => el.classList.remove('loading')); }
    }

    function updatePrices(cur, rates) {
        const rate = rates[cur];
        document.querySelectorAll('.card-price-value').forEach(el => {
            const base = parseFloat(el.getAttribute('data-base-aed'));
            if (!isNaN(base)) {
                let final = base * rate;
                if (cur !== 'AED') final = Math.round(final / 10) * 10;
                el.innerText = new Intl.NumberFormat('en-US', { style:'currency', currency: cur, minimumFractionDigits:0 }).format(final);
            }
            el.classList.remove('loading');
        });
    }

    init();
})();
