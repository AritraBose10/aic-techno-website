/**
 * firebase-cms-sync.js
 * Real-time Firestore sync client for AIC Techno Website
 * Synchronizes Mentors, Extended Mentors, Workspace, Apply Stages, Careers, and Partners
 *
 * Fixes:
 *  1. Flicker — static HTML mentor cards are hidden immediately via a CSS class
 *     added before Firestore loads. The class is removed once data arrives.
 *  2. Active filter — boards/grids are always cleared and re-rendered regardless
 *     of whether the filtered array is empty, so inactive mentors are hidden.
 *  3. Order-state bleed — each onSnapshot callback is fully self-contained and
 *     rebuilds the grid from scratch using only its own sorted data.
 */

(function () {
  const firebaseConfig = {
    apiKey: "AIzaSyClv5MIo8RjatXoZwRbSjkehOb27wMqixo",
    authDomain: "aic-techno-cms.firebaseapp.com",
    projectId: "aic-techno-cms",
    storageBucket: "aic-techno-cms.firebasestorage.app",
    messagingSenderId: "159332667631",
    appId: "1:159332667631:web:bf52340d7b0ce106af8b1a",
  };

  // Local IntersectionObserver for dynamic items added after page load
  const localObs = typeof IntersectionObserver !== "undefined"
    ? new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("on");
            localObs.unobserve(entry.target);
          }
        });
      }, { threshold: 0.1 })
    : null;

  function observeElements(container) {
    if (!container || !localObs) return;
    container.querySelectorAll(".rev, .rev-l, .rev-r").forEach((el) => {
      localObs.observe(el);
    });
  }

  function initSync() {
    if (typeof firebase === "undefined" || !firebase.apps) {
      console.warn("Firebase SDK not loaded. Skipping live CMS sync.");
      return;
    }

    if (!firebase.apps.length) {
      firebase.initializeApp(firebaseConfig);
    }
    const db = firebase.firestore();

    // Call dynamic page loader for page.html?slug=...
    initCustomPageSync(db);

    // Dynamic custom page links in navbar
    db.collection("pages")
      .where("published", "==", true)
      .onSnapshot((snapshot) => {
        const pages = [];
        snapshot.forEach((doc) => {
          pages.push({ id: doc.id, ...doc.data() });
        });
        pages.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

        const navContainers = document.querySelectorAll(".nav-links");
        navContainers.forEach((navContainer) => {
          navContainer.querySelectorAll(".cms-dynamic-nav-link").forEach((el) => el.remove());
          pages.forEach((p) => {
            const link = document.createElement("a");
            link.href = `page.html?slug=${p.slug}`;
            link.textContent = p.title;
            link.className = "cms-dynamic-nav-link";
            const bookLink = navContainer.querySelector('a[href*="workspace-booking"]');
            if (bookLink) {
              navContainer.insertBefore(link, bookLink);
            } else {
              navContainer.appendChild(link);
            }
          });
        });
      }, (err) => {
        console.error("Navbar pages sync error:", err);
      });

    // Track whether first mentor snapshot has resolved
    let mentorsReady = false;
    let extendedReady = false;

    function checkReveal() {
      if (mentorsReady && extendedReady) revealMentors();
    }

    // ─── 1. MENTORS & BOARD MEMBERS (boardMembers collection) ─────────────────────
    db.collection("boardMembers").onSnapshot((snapshot) => {
      const allMentors = [];
      snapshot.forEach((doc) => {
        allMentors.push({ id: doc.id, ...doc.data() });
      });

      // Sort by order field (independent sort — no shared state)
      allMentors.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

      // Filter by active flag — treat missing field as active (true)
      const advisory = allMentors.filter(
        (m) => m.board === "Advisory Board" && m.active !== false
      );
      const executive = allMentors.filter(
        (m) => m.board === "Executive Board" && m.active !== false
      );

      const mentorsSec = document.getElementById("mentors");
      if (mentorsSec) {
        const boardGrids = mentorsSec.querySelectorAll(".board-grid");

        // Always replace Advisory Board grid (even if empty — clears inactive)
        if (boardGrids[0]) {
          boardGrids[0].innerHTML = advisory.map(renderMentorCard).join("");
        }

        // Always replace Executive Board grid
        if (boardGrids[1]) {
          boardGrids[1].innerHTML = executive.map(renderMentorCard).join("");
        }
      }

      mentorsReady = true;
      checkReveal();
    }, (err) => {
      console.error("BoardMembers sync error:", err);
      mentorsReady = true;
      checkReveal();
    });

    // ─── 2. EXTENDED MENTORS (mentors collection) ────────────────────
    db.collection("mentors").onSnapshot((snapshot) => {
      const extended = [];
      snapshot.forEach((doc) => {
        extended.push({ id: doc.id, ...doc.data() });
      });

      // Independent sort — no shared state with mentors sort
      extended.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

      // Filter active — treat missing field as active
      const activeExtended = extended.filter((m) => m.active !== false);

      const socialGrid = document.querySelector("#social-mentors .mentor-grid");
      if (socialGrid) {
        // Always replace grid — clears static HTML and inactive cards
        socialGrid.innerHTML = activeExtended.map(renderExtendedMentorCard).join("");

        // Update modal counter
        const countEl = document.getElementById("mentorsMoreCount");
        if (countEl) {
          countEl.textContent = `(${activeExtended.length})`;
        }
      }

      extendedReady = true;
      checkReveal();
    }, (err) => {
      console.error("Extended mentors sync error:", err);
      extendedReady = true;
      checkReveal();
    });

    // ─── 3. WORKSPACE PLANS (siteContent/workspace) ──────────────────────────
    db.collection("siteContent").doc("workspace").onSnapshot((doc) => {
      if (!doc.exists) return;
      const data = doc.data();

      // Title & subtitle
      const wsTitle = document.querySelector("#workspace .sec-h");
      const wsSub = document.querySelector("#workspace .sec-p");
      if (wsTitle && data.title) wsTitle.textContent = data.title;
      if (wsSub && data.subtitle) wsSub.textContent = data.subtitle;

      // Plans grid — no emoji icons
      const plansContainer = document.querySelector("#workspace .aic-grid");
      if (plansContainer && data.plans && data.plans.length > 0) {
        plansContainer.innerHTML = data.plans
          .map(
            (plan) => `
          <div class="aic-card">
            <div class="aic-title">${plan.name}</div>
            <p class="aic-desc">${plan.description}</p>
          </div>
        `
          )
          .join("");
      }
    });

    // ─── 4. APPLY / INCUBATION STAGES (siteContent/apply) ────────────────────
    db.collection("siteContent").doc("apply").onSnapshot((doc) => {
      if (!doc.exists) return;
      const data = doc.data();

      // Section Title & Subtitle
      const applyTitle = document.querySelector("#apply .sec-h");
      const applySub = document.querySelector("#apply .sec-p");
      if (applyTitle && data.title) applyTitle.textContent = data.title;
      if (applySub && data.subtitle) applySub.textContent = data.subtitle;

      // Stages grid — no emoji icons
      const applyGrid = document.querySelector("#apply .apply-grid");
      if (applyGrid && data.stages && data.stages.length > 0) {
        applyGrid.innerHTML = data.stages
          .map(
            (stage, idx) => `
          <div class="apply-card">
            <div class="apply-stage">
              <span class="num">${stage.stage || idx + 1}</span> ${stage.title}
            </div>
            <h3>${stage.title}</h3>
            <p>${stage.description}</p>
            <a class="apply-btn" href="${stage.applyUrl || '#'}" target="_blank" rel="noopener">
              Apply Now →
            </a>
          </div>
        `
          )
          .join("");
      }
    });

    // ─── 5. CAREERS (careers collection) ──────────────────────────────────────
    db.collection("careers").onSnapshot((snapshot) => {
      const careers = [];
      snapshot.forEach((doc) => {
        careers.push({ id: doc.id, ...doc.data() });
      });
      careers.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

      const activeCareers = careers.filter((c) => c.active !== false);

      const careersGrid = document.querySelector("#careers .careers-grid");
      if (careersGrid) {
        if (activeCareers.length > 0) {
          careersGrid.innerHTML = activeCareers
            .map(
              (job) => `
            <div class="job-card">
              <div class="job-left">
                <div>
                  <div class="job-dept">${job.dept}</div>
                  <div class="job-title">${job.title}</div>
                  <div class="job-meta">
                    ${(job.tags || []).map((t) => `<span class="job-tag">${t}</span>`).join("")}
                  </div>
                </div>
              </div>
              <a class="job-apply" href="${job.applyLink || 'mailto:careers@aic-techno.com'}" target="_blank" rel="noopener">
                Apply Now →
              </a>
            </div>
          `
            )
            .join("");
        } else {
          careersGrid.innerHTML = `<div style="text-align: center; color: rgba(255,255,255,0.5); width: 100%; grid-column: 1/-1; padding: 2rem;">No open positions at this moment.</div>`;
        }
      }
    });

    // ─── 6. PARTNERS (partners collection) ────────────────────────────────────
    db.collection("partners").onSnapshot((snapshot) => {
      const partners = [];
      snapshot.forEach((doc) => {
        partners.push({ id: doc.id, ...doc.data() });
      });
      partners.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

      const govt = partners.filter((p) => p.category?.toLowerCase() === "govt");
      const inst = partners.filter((p) => p.category?.toLowerCase() === "institutional");
      const tech = partners.filter((p) => p.category?.toLowerCase() === "tech");

      const partnerRows = document.querySelectorAll("#partners .partners-row");
      if (partnerRows[0]) {
        partnerRows[0].innerHTML = govt.map(renderPartnerLogo).join("");
      }
      if (partnerRows[1]) {
        partnerRows[1].innerHTML = inst.map(renderPartnerLogo).join("");
      }
      if (partnerRows[2]) {
        partnerRows[2].innerHTML = tech.map(renderPartnerLogo).join("");
      }
    });

    // ─── 7. FEATURED PARTNERS (featuredPartners collection) ─────────────────
    db.collection("featuredPartners").onSnapshot((snapshot) => {
      snapshot.forEach((doc) => {
        const p = { id: doc.id, ...doc.data() };
        if (p.type === "fablab") {
          const container = document.getElementById("fablabFeature");
          if (container) {
            container.innerHTML = renderFeaturedPartner(p);
          }
        } else if (p.type === "learning") {
          const container = document.getElementById("learningFeature");
          if (container) {
            container.innerHTML = renderFeaturedPartner(p);
          }
        }
      });
    }, (err) => {
      console.error("Featured partners sync error:", err);
    });

    // ─── 8. HERO SECTION (siteContent/hero) ──────────────────────────────────
    db.collection("siteContent").doc("hero").onSnapshot((doc) => {
      if (!doc.exists) return;
      const data = doc.data();

      const heroTitle = document.querySelector("#hero .hero-h1");
      const heroSub = document.querySelector("#hero .hero-sub");
      const cta1 = document.querySelector("#hero .hero-btns a.primary");
      const cta2 = document.querySelector("#hero .hero-btns a.ghost");
      const tags = document.querySelectorAll("#hero .aim-tag");

      if (heroTitle && data.title) heroTitle.textContent = data.title;
      if (heroSub && data.subtitle) heroSub.textContent = data.subtitle;

      if (cta1) {
        if (data.cta1Text) cta1.textContent = data.cta1Text;
        if (data.cta1Link) cta1.setAttribute("href", data.cta1Link);
      }
      if (cta2) {
        if (data.cta2Text) cta2.textContent = data.cta2Text;
        if (data.cta2Link) cta2.setAttribute("href", data.cta2Link);
      }

      if (tags[0] && data.aimTag1) {
        tags[0].innerHTML = data.aimTag1.replace("NITI Aayog", "<strong>NITI Aayog</strong>");
      }
      if (tags[1] && data.aimTag2) {
        tags[1].textContent = data.aimTag2;
      }
    }, (err) => {
      console.error("Hero sync error:", err);
    });

    // ─── 9. ABOUT TIG SECTION (siteContent/aboutTIG) ─────────────────────────
    db.collection("siteContent").doc("aboutTIG").onSnapshot((doc) => {
      if (!doc.exists) return;
      const data = doc.data();

      const tigTag = document.getElementById("tig-section-tag");
      const tigTitle = document.getElementById("tig-title");
      const tigSub = document.getElementById("tig-subtitle");
      const tigDesc1 = document.getElementById("tig-desc1");
      const tigDesc2 = document.getElementById("tig-desc2");
      const tigStatsBlock = document.getElementById("tig-stats-block");

      if (tigTag && data.sectionTag) tigTag.textContent = data.sectionTag;
      if (tigTitle && data.title) tigTitle.textContent = data.title;
      if (tigSub && data.subtitle) tigSub.textContent = data.subtitle;
      if (tigDesc1 && data.description1) tigDesc1.textContent = data.description1;
      if (tigDesc2 && data.description2) tigDesc2.textContent = data.description2;

      if (tigStatsBlock && data.stats && data.stats.length > 0) {
        let rowsHtml = "";
        for (let i = 0; i < data.stats.length; i += 2) {
          const stat1 = data.stats[i];
          const stat2 = data.stats[i + 1];
          rowsHtml += `
            <div class="tig-stat-row">
              <div class="tig-stat-cell">
                <span class="n">${stat1.value || ""}</span>
                <span class="l">${stat1.label || ""}</span>
              </div>
              ${stat2 ? `
              <div class="tig-stat-cell">
                <span class="n">${stat2.value || ""}</span>
                <span class="l">${stat2.label || ""}</span>
              </div>
              ` : ""}
            </div>
          `;
        }

        const estBarHtml = `
          <div class="tig-est-bar">
            <span>${data.foundedLabel || "Founded"}</span>
            <strong>${data.foundedYear || "1984"}</strong>
            <span style="margin-left:auto">Techno India Group</span>
          </div>
        `;

        tigStatsBlock.innerHTML = rowsHtml + estBarHtml;
      }
    }, (err) => {
      console.error("About TIG sync error:", err);
    });

    // ─── 10. ABOUT AIC SECTION (siteContent/aboutAIC) ────────────────────────
    db.collection("siteContent").doc("aboutAIC").onSnapshot((doc) => {
      if (!doc.exists) return;
      const data = doc.data();

      const aicTag = document.getElementById("aic-section-tag");
      const aicHeading = document.getElementById("aic-heading");
      const aicSub = document.getElementById("aic-subtitle");
      const aicCardsGrid = document.getElementById("aic-cards-grid");

      if (aicTag && data.sectionTag) aicTag.textContent = data.sectionTag;
      if (aicHeading && data.heading) aicHeading.textContent = data.heading;
      if (aicSub && data.subtitle) aicSub.textContent = data.subtitle;

      if (aicCardsGrid && data.cards && data.cards.length > 0) {
        const alreadyRevealed = aicCardsGrid.querySelector(".aic-card.on") !== null;
        aicCardsGrid.innerHTML = data.cards.map((card, i) => `
          <div class="aic-card rev ${alreadyRevealed ? "on" : ""}" style="transition-delay:${i * 0.08}s">
            <div class="aic-icon">${card.icon || "💡"}</div>
            <div class="aic-title">${card.title || ""}</div>
            <p class="aic-desc">${card.description || ""}</p>
          </div>
        `).join("");
        if (!alreadyRevealed) {
          observeElements(aicCardsGrid);
        }
      }
    }, (err) => {
      console.error("About AIC sync error:", err);
    });
  }

  // ─── Card Renderers ────────────────────────────────────────────────────────
  function renderMentorCard(m) {
    return `
      <div class="mentor-card">
        <div class="mentor-avatar">
          <span class="mentor-initials">${m.initials || (m.name || "?").substring(0, 2).toUpperCase()}</span>
          ${m.photoUrl ? `<img src="${m.photoUrl}" alt="${m.name}" loading="lazy">` : ""}
        </div>
        <div class="mentor-name">${m.name}</div>
        <div class="mentor-role">${m.role || ""}</div>
        ${m.bio ? `<p class="mentor-bio">${m.bio}</p>` : ""}
        ${
          m.linkedIn
            ? `<a class="mentor-linkedin" href="${m.linkedIn}" target="_blank" rel="noopener">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.45 20.45h-3.56v-5.57c0-1.33-.02-3.04-1.85-3.04-1.85 0-2.14 1.45-2.14 2.94v5.67H9.34V9h3.42v1.56h.05c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.46v6.28zM5.34 7.43a2.07 2.07 0 1 1 0-4.14 2.07 2.07 0 0 1 0 4.14zM7.12 20.45H3.56V9h3.56v11.45zM22.22 0H1.77C.79 0 0 .77 0 1.73v20.54C0 23.23.79 24 1.77 24h20.45c.98 0 1.78-.77 1.78-1.73V1.73C24 .77 23.2 0 22.22 0z"/></svg>
                LinkedIn
               </a>`
            : ""
        }
      </div>
    `;
  }

  function renderExtendedMentorCard(m) {
    return `
      <div class="mentor-card">
        <div class="mentor-avatar">
          <span class="mentor-initials">${m.initials || (m.name || "?").substring(0, 2).toUpperCase()}</span>
          ${m.photoUrl ? `<img src="${m.photoUrl}" alt="${m.name}" loading="lazy">` : ""}
        </div>
        <div class="mentor-name">${m.name}</div>
        <div class="mentor-role">${m.role || ""}</div>
        ${
          m.linkedIn
            ? `<a class="mentor-linkedin" href="${m.linkedIn}" target="_blank" rel="noopener">
                <svg viewBox="0 0 24 24"><path d="M19 3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14m-.5 15.5v-5.3a3.26 3.26 0 0 0-3.26-3.26c-.85 0-1.84.52-2.28 1.3v-1.11h-2.79v8.37h2.79v-4.93c0-.77.62-1.4 1.39-1.4a1.4 1.4 0 0 1 1.4 1.4v4.93h2.75M6.46 10.9v8.37H9.25V10.9H6.46M7.86 6.78a1.64 1.64 0 1 0 0 3.28 1.64 1.64 0 0 0 0-3.28z"/></svg>
                LinkedIn
               </a>`
            : ""
        }
      </div>
    `;
  }

  function renderFeaturedPartner(p) {
    const name = p.name || "";
    const tagline = p.tagline || "";
    const meta = p.meta || "";
    const description = p.description || p.desc || "";
    const initials = p.initials || (name ? name.substring(0, 2).toUpperCase() : "");
    const logoUrl = p.logoUrl || "";
    const focusCards = p.focusCards || p.focus || [];
    const gallery = p.gallery || [];
    const contactEmail = p.contactEmail || p.email || "";

    return `
      <div class="fablab-head">
        <div class="fablab-logo">
          <span class="fablab-initials">${initials}</span>
          ${logoUrl ? `<img src="${logoUrl}" alt="${name} logo" loading="lazy" onerror="this.remove()">` : ""}
        </div>
        <div>
          <div class="fablab-name">${name}</div>
          ${tagline ? `<div class="fablab-tagline">"${tagline}"</div>` : ""}
          ${meta ? `<div class="fablab-meta">${meta}</div>` : ""}
        </div>
      </div>
      <p class="fablab-desc">${description}</p>
      <div class="fablab-focus">
        ${focusCards.map(card => `
          <div class="fablab-focus-card">
            <div class="fablab-focus-icon">${card.icon || "💡"}</div>
            <div class="fablab-focus-title">${card.title || card.name || ""}</div>
            <p>${card.body || card.description || card.desc || ""}</p>
          </div>
        `).join("")}
      </div>
      <div class="fablab-gallery">
        ${gallery.map(imgUrl => `
          <div class="fablab-shot"><img src="${imgUrl}" alt="Gallery photo" loading="lazy" onerror="this.remove()"></div>
        `).join("")}
      </div>
      ${contactEmail ? `
        <div class="fablab-contact-row">
          <a class="fablab-contact" href="mailto:${contactEmail}">✉ ${contactEmail}</a>
        </div>
      ` : ""}
    `;
  }

  function renderPartnerLogo(p) {
    return `
      <div class="partner-logo ${p.featured ? "featured" : ""}">
        ${p.logoUrl ? `<img src="${p.logoUrl}" alt="${p.name}" style="height:32px;width:auto;object-fit:contain">` : p.name}
      </div>
    `;
  }

  // ─── 10. DYNAMIC PAGE TEMPLATE LOADER (page.html?slug=...) ─────────────────
  function initCustomPageSync(db) {
    const pageContentEl = document.getElementById("page-content");
    if (!pageContentEl) return; // Not on page.html

    const params = new URLSearchParams(window.location.search);
    const slug = params.get("slug");

    const pageTitleEl = document.getElementById("page-title");
    const pageBreadcrumbEl = document.getElementById("page-breadcrumb");
    const pageBannerEl = document.getElementById("page-banner");
    const page404El = document.getElementById("page-404");
    const pageContainerEl = document.getElementById("page-body-container");

    function show404() {
      if (pageContainerEl) pageContainerEl.style.display = "none";
      if (page404El) page404El.style.display = "block";
      document.title = "404 - Page Not Found | AIC Techno";
    }

    if (!slug) {
      show404();
      return;
    }

    db.collection("pages")
      .where("slug", "==", slug)
      .where("published", "==", true)
      .limit(1)
      .onSnapshot(
        (snapshot) => {
          if (snapshot.empty) {
            show404();
            return;
          }

          const pageData = snapshot.docs[0].data();

          // Update SEO tab title & meta description
          if (pageData.seoTitle) {
            document.title = pageData.seoTitle;
          } else if (pageData.title) {
            document.title = `${pageData.title} | AIC Techno`;
          }

          if (pageData.metaDescription) {
            let metaDesc = document.querySelector('meta[name="description"]');
            if (!metaDesc) {
              metaDesc = document.createElement("meta");
              metaDesc.name = "description";
              document.head.appendChild(metaDesc);
            }
            metaDesc.content = pageData.metaDescription;
          }

          // Populate layout elements
          if (pageTitleEl && pageData.title) pageTitleEl.textContent = pageData.title;
          if (pageBreadcrumbEl && pageData.title) pageBreadcrumbEl.textContent = `Home / ${pageData.title}`;

          if (pageBannerEl && pageData.bannerImage) {
            pageBannerEl.style.backgroundImage = `url('${pageData.bannerImage}')`;
            pageBannerEl.style.backgroundSize = "cover";
            pageBannerEl.style.backgroundPosition = "center";
          }

          if (pageContentEl && pageData.content) {
            pageContentEl.innerHTML = pageData.content;
          }

          if (page404El) page404El.style.display = "none";
          if (pageContainerEl) pageContainerEl.style.display = "block";
        },
        (err) => {
          console.error("Page sync error:", err);
          show404();
        }
      );
  }

  // Auto-run on DOM ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initSync);
  } else {
    initSync();
  }
})();
