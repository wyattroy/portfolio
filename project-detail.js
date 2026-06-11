/**
 * project-detail.js — Lightbox and video lazy-load utilities
 */

// ─── Lightbox state ───────────────────────────────────────────────────────────
let lightboxImages = [];
let lightboxIndex = 0;

// ─── Init ─────────────────────────────────────────────────────────────────────
export function initLightbox() {
  const lb = document.getElementById('lightbox');
  const img = document.getElementById('lightbox-img');
  const closeBtn = document.getElementById('lightbox-close');
  const prevBtn = document.getElementById('lightbox-prev');
  const nextBtn = document.getElementById('lightbox-next');
  const counter = document.getElementById('lightbox-counter');

  if (!lb || !img) return;

  function showImage(index) {
    const item = lightboxImages[index];
    if (!item) return;
    img.src = item.src;
    img.alt = item.alt || '';
    lightboxIndex = index;
    if (counter) {
      counter.textContent = `${index + 1} / ${lightboxImages.length}`;
    }
    // Show/hide nav buttons
    if (prevBtn) prevBtn.style.display = lightboxImages.length > 1 ? '' : 'none';
    if (nextBtn) nextBtn.style.display = lightboxImages.length > 1 ? '' : 'none';
  }

  function openLightbox(images, startIndex = 0) {
    lightboxImages = images;
    lightboxIndex = startIndex;
    showImage(startIndex);
    lb.classList.add('open');
    lb.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    closeBtn?.focus();
  }

  function closeLightbox() {
    lb.classList.remove('open');
    lb.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
    img.src = '';
    lightboxImages = [];
  }

  function prev() {
    if (lightboxImages.length === 0) return;
    showImage((lightboxIndex - 1 + lightboxImages.length) % lightboxImages.length);
  }

  function next() {
    if (lightboxImages.length === 0) return;
    showImage((lightboxIndex + 1) % lightboxImages.length);
  }

  // Button handlers
  closeBtn?.addEventListener('click', closeLightbox);
  prevBtn?.addEventListener('click', prev);
  nextBtn?.addEventListener('click', next);

  // Click outside image to close
  lb.addEventListener('click', e => {
    if (e.target === lb) closeLightbox();
  });

  // Keyboard navigation
  document.addEventListener('keydown', e => {
    if (!lb.classList.contains('open')) return;
    if (e.key === 'Escape') closeLightbox();
    if (e.key === 'ArrowLeft') prev();
    if (e.key === 'ArrowRight') next();
  });

  // Touch swipe support
  let touchStartX = 0;
  lb.addEventListener('touchstart', e => {
    touchStartX = e.touches[0].clientX;
  }, { passive: true });

  lb.addEventListener('touchend', e => {
    const dx = e.changedTouches[0].clientX - touchStartX;
    if (Math.abs(dx) > 50) {
      if (dx < 0) next();
      else prev();
    }
  }, { passive: true });

  // Listen for event from project-list.js
  window.addEventListener('openLightbox', e => {
    const { images, index } = e.detail;
    openLightbox(images, index);
  });

  // Expose globally for direct calls if needed
  window.openLightbox = openLightbox;
  window.closeLightbox = closeLightbox;
}

// ─── Video lazy load utility ──────────────────────────────────────────────────
/**
 * Given a container element with data-src set on a .video-placeholder,
 * replaces the placeholder with an iframe when called.
 *
 * This is called from project-list.js when a card is expanded.
 * The function is exported for potential external use.
 */
export function activateVideoPlaceholder(placeholder) {
  const src = placeholder.dataset.src;
  if (!src) return;

  const iframe = document.createElement('iframe');
  iframe.src = src;
  iframe.allow = 'autoplay; fullscreen; picture-in-picture';
  iframe.allowFullscreen = true;
  iframe.style.cssText = 'width:100%;height:100%;border:none;display:block;';
  iframe.title = placeholder.getAttribute('aria-label') || 'Video';

  placeholder.parentElement.replaceChild(iframe, placeholder);
}
