/**
 * Access Request Modal
 * Captures: page URL, referrer, optional reason, optional free-text
 * Stores to Supabase access_requests table
 */

(function() {
  'use strict';

  const SUPABASE_URL = 'https://dwncravjhkbclbuzijra.supabase.co';

  // Reason categories (neutral, no marketing language)
  const REASONS = [
    { id: 'communication', label: 'Communication breakdown' },
    { id: 'scheduling', label: 'Scheduling conflicts' },
    { id: 'mediation', label: 'Preparing for mediation or legal discussions' },
    { id: 'court-order', label: 'Court order not working' },
    { id: 'exploring', label: 'Exploring options' }
  ];

  // Create modal HTML
  function createModal() {
    const modal = document.createElement('div');
    modal.id = 'accessModal';
    modal.className = 'access-modal';
    modal.innerHTML = `
      <div class="access-modal-backdrop"></div>
      <div class="access-modal-content">
        <button class="access-modal-close" aria-label="Close">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>

        <h2>Request private beta access</h2>
        <p class="access-modal-subtitle">We're gradually opening access. Tell us a bit about your situation.</p>

        <form id="accessForm" class="access-modal-form">
          <div class="access-form-group">
            <label for="accessEmail">Email address</label>
            <input type="email" id="accessEmail" name="email" required placeholder="you@example.com">
          </div>

          <div class="access-form-group">
            <label>What brings you here? <span class="optional">(optional)</span></label>
            <div class="access-reason-chips">
              ${REASONS.map(r => `
                <button type="button" class="access-reason-chip" data-reason="${r.id}">
                  ${r.label}
                </button>
              `).join('')}
            </div>
          </div>

          <div class="access-form-group">
            <label for="accessNotes">Anything else you'd like to share? <span class="optional">(optional)</span></label>
            <textarea id="accessNotes" name="notes" rows="3" placeholder=""></textarea>
          </div>

          <button type="submit" class="access-submit-btn">
            Request access
          </button>

          <p class="access-privacy-note">We'll only use your email to send you access info.</p>
        </form>

        <div id="accessSuccess" class="access-success" style="display: none;">
          <div class="access-success-icon">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
              <polyline points="22 4 12 14.01 9 11.01"></polyline>
            </svg>
          </div>
          <h3>Request received</h3>
          <p>We'll be in touch when we're ready to welcome you.</p>
          <button class="access-done-btn">Done</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    return modal;
  }

  // Initialize modal
  function initModal() {
    const modal = createModal();
    const backdrop = modal.querySelector('.access-modal-backdrop');
    const closeBtn = modal.querySelector('.access-modal-close');
    const form = modal.querySelector('#accessForm');
    const reasonChips = modal.querySelectorAll('.access-reason-chip');
    const successView = modal.querySelector('#accessSuccess');
    const doneBtn = modal.querySelector('.access-done-btn');

    let selectedReason = null;

    // Close modal handlers
    function closeModal() {
      modal.classList.remove('open');
      document.body.style.overflow = '';
      // Reset form after animation
      setTimeout(() => {
        form.reset();
        form.style.display = 'block';
        successView.style.display = 'none';
        selectedReason = null;
        reasonChips.forEach(c => c.classList.remove('selected'));
      }, 300);
    }

    backdrop.addEventListener('click', closeModal);
    closeBtn.addEventListener('click', closeModal);
    doneBtn.addEventListener('click', closeModal);

    // Escape key closes modal
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && modal.classList.contains('open')) {
        closeModal();
      }
    });

    // Reason chip selection
    reasonChips.forEach(chip => {
      chip.addEventListener('click', () => {
        reasonChips.forEach(c => c.classList.remove('selected'));
        if (selectedReason === chip.dataset.reason) {
          selectedReason = null;
        } else {
          chip.classList.add('selected');
          selectedReason = chip.dataset.reason;
        }
      });
    });

    // Form submission
    form.addEventListener('submit', async (e) => {
      e.preventDefault();

      const submitBtn = form.querySelector('.access-submit-btn');
      const email = form.querySelector('#accessEmail').value.trim();
      const notes = form.querySelector('#accessNotes').value.trim();

      submitBtn.disabled = true;
      submitBtn.textContent = 'Submitting...';

      const data = {
        email: email,
        reason: selectedReason || null,
        notes: notes || null,
        page_url: window.location.href,
        referrer: document.referrer || null,
        submitted_at: new Date().toISOString()
      };

      try {
        const response = await fetch(`${SUPABASE_URL}/functions/v1/access-request`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data)
        });

        if (!response.ok) {
          throw new Error('Request failed');
        }

        // Show success
        form.style.display = 'none';
        successView.style.display = 'block';

      } catch (error) {
        console.error('Access request error:', error);
        // Fallback: open mailto with context
        const subject = encodeURIComponent('Request private beta access');
        const body = encodeURIComponent(
          `Email: ${email}\n` +
          `Reason: ${selectedReason || 'Not specified'}\n` +
          `Notes: ${notes || 'None'}\n` +
          `Page: ${window.location.href}\n` +
          `Referrer: ${document.referrer || 'Direct'}`
        );
        window.location.href = `mailto:hello@getclearly.app?subject=${subject}&body=${body}`;
        closeModal();
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Request access';
      }
    });

    return modal;
  }

  // Open modal function (exposed globally)
  function openAccessModal() {
    let modal = document.getElementById('accessModal');
    if (!modal) {
      modal = initModal();
    }
    modal.classList.add('open');
    document.body.style.overflow = 'hidden';
    // Focus email input
    setTimeout(() => {
      modal.querySelector('#accessEmail')?.focus();
    }, 100);
  }

  // Attach to all access request links
  function attachToLinks() {
    document.querySelectorAll('a[href*="Request%20private%20beta%20access"], a[href*="Request private beta access"]').forEach(link => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        openAccessModal();
      });
    });

    // Also attach to elements with data-access-modal attribute
    document.querySelectorAll('[data-access-modal]').forEach(el => {
      el.addEventListener('click', (e) => {
        e.preventDefault();
        openAccessModal();
      });
    });
  }

  // Initialize on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', attachToLinks);
  } else {
    attachToLinks();
  }

  // Expose globally
  window.openAccessModal = openAccessModal;
})();
