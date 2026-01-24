/**
 * Professional Interest Modal
 * Captures: email, role type, feature interests, optional notes
 * Stores to Supabase z_professionals table
 */

(function() {
  'use strict';

  const SUPABASE_URL = 'https://dwncravjhkbclbuzijra.supabase.co';

  // Professional role types
  const ROLES = [
    { id: 'family-lawyer', label: 'Family Law Attorney' },
    { id: 'mediator', label: 'Mediator' },
    { id: 'therapist', label: 'Therapist / Counselor' },
    { id: 'parenting-coordinator', label: 'Parenting Coordinator' },
    { id: 'social-worker', label: 'Social Worker' },
    { id: 'other', label: 'Other' }
  ];

  // Features professionals might be interested in
  const FEATURES = [
    { id: 'communication-records', label: 'Communication records' },
    { id: 'calendar-export', label: 'Calendar documentation' },
    { id: 'expense-tracking', label: 'Expense tracking' },
    { id: 'pdf-export', label: 'PDF exports for court' },
    { id: 'client-referral', label: 'Client referral program' },
    { id: 'bulk-licensing', label: 'Bulk licensing' }
  ];

  // Create modal HTML
  function createModal() {
    const modal = document.createElement('div');
    modal.id = 'professionalModal';
    modal.className = 'pro-modal';
    modal.innerHTML = `
      <div class="pro-modal-backdrop"></div>
      <div class="pro-modal-content">
        <button class="pro-modal-close" aria-label="Close">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>

        <h2>Join the professional network</h2>

        <form id="professionalForm" class="pro-modal-form">
          <div class="pro-form-group">
            <label for="proModalEmail">Email address</label>
            <input type="email" id="proModalEmail" name="email" required placeholder="you@example.com">
          </div>

          <div class="pro-form-group">
            <label>What's your role? <span class="optional">(optional)</span></label>
            <div class="pro-role-chips">
              ${ROLES.map(r => `
                <button type="button" class="pro-role-chip" data-role="${r.id}">
                  ${r.label}
                </button>
              `).join('')}
            </div>
          </div>

          <div class="pro-form-group">
            <label>What features interest you most? <span class="optional">(select all that apply)</span></label>
            <div class="pro-feature-chips">
              ${FEATURES.map(f => `
                <button type="button" class="pro-feature-chip" data-feature="${f.id}">
                  ${f.label}
                </button>
              `).join('')}
            </div>
          </div>

          <div class="pro-form-group">
            <label for="proModalNotes">Anything else you'd like us to know? <span class="optional">(optional)</span></label>
            <textarea id="proModalNotes" name="notes" rows="2" placeholder=""></textarea>
          </div>

          <button type="submit" class="pro-submit-btn">
            Join the list
          </button>

          <p class="pro-privacy-note">We'll only use your email for professional updates and partnership info.</p>
        </form>

        <div id="proModalSuccess" class="pro-modal-success" style="display: none;">
          <div class="pro-success-icon">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
              <polyline points="22 4 12 14.01 9 11.01"></polyline>
            </svg>
          </div>
          <h3>You're on the list</h3>
          <p>We'll be in touch with updates for professionals.</p>
          <button class="pro-done-btn">Done</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    return modal;
  }

  // Initialize modal
  function initModal() {
    const modal = createModal();
    const backdrop = modal.querySelector('.pro-modal-backdrop');
    const closeBtn = modal.querySelector('.pro-modal-close');
    const form = modal.querySelector('#professionalForm');
    const roleChips = modal.querySelectorAll('.pro-role-chip');
    const featureChips = modal.querySelectorAll('.pro-feature-chip');
    const successView = modal.querySelector('#proModalSuccess');
    const doneBtn = modal.querySelector('.pro-done-btn');

    let selectedRole = null;
    let selectedFeatures = [];

    // Close modal handlers
    function closeModal() {
      modal.classList.remove('open');
      document.body.style.overflow = '';
      // Reset form after animation
      setTimeout(() => {
        form.reset();
        form.style.display = 'block';
        successView.style.display = 'none';
        selectedRole = null;
        selectedFeatures = [];
        roleChips.forEach(c => c.classList.remove('selected'));
        featureChips.forEach(c => c.classList.remove('selected'));
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

    // Role chip selection (single select)
    roleChips.forEach(chip => {
      chip.addEventListener('click', () => {
        roleChips.forEach(c => c.classList.remove('selected'));
        if (selectedRole === chip.dataset.role) {
          selectedRole = null;
        } else {
          chip.classList.add('selected');
          selectedRole = chip.dataset.role;
        }
      });
    });

    // Feature chip selection (multi-select)
    featureChips.forEach(chip => {
      chip.addEventListener('click', () => {
        const feature = chip.dataset.feature;
        if (selectedFeatures.includes(feature)) {
          selectedFeatures = selectedFeatures.filter(f => f !== feature);
          chip.classList.remove('selected');
        } else {
          selectedFeatures.push(feature);
          chip.classList.add('selected');
        }
      });
    });

    // Form submission
    form.addEventListener('submit', async (e) => {
      e.preventDefault();

      const submitBtn = form.querySelector('.pro-submit-btn');
      const email = form.querySelector('#proModalEmail').value.trim();
      const notes = form.querySelector('#proModalNotes').value.trim();

      submitBtn.disabled = true;
      submitBtn.textContent = 'Submitting...';

      const data = {
        email: email,
        role_type: selectedRole || null,
        feature_interests: selectedFeatures.length > 0 ? selectedFeatures : null,
        notes: notes || null
      };

      try {
        const response = await fetch(`${SUPABASE_URL}/functions/v1/professional-signup`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data)
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.error || 'Request failed');
        }

        // Show success
        form.style.display = 'none';
        successView.style.display = 'block';

        // GA4 event tracking
        window.dataLayer = window.dataLayer || [];
        window.dataLayer.push({
          'event': 'form_submit',
          'form_name': 'professional_signup'
        });

      } catch (error) {
        console.error('Professional signup error:', error);
        // Show success anyway if it's a duplicate email error
        if (error.message && error.message.includes('already')) {
          form.style.display = 'none';
          successView.style.display = 'block';

          // GA4 event tracking (duplicate counts as success)
          window.dataLayer = window.dataLayer || [];
          window.dataLayer.push({
            'event': 'form_submit',
            'form_name': 'professional_signup'
          });
        } else {
          alert('Something went wrong. Please try again.');
        }
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Join the list';
      }
    });

    return modal;
  }

  // Open modal function (exposed globally)
  function openProfessionalModal() {
    let modal = document.getElementById('professionalModal');
    if (!modal) {
      modal = initModal();
    }
    modal.classList.add('open');
    document.body.style.overflow = 'hidden';
    // Focus email input
    setTimeout(() => {
      modal.querySelector('#proModalEmail')?.focus();
    }, 100);
  }

  // Attach to elements with data-professional-modal attribute
  function attachToElements() {
    document.querySelectorAll('[data-professional-modal]').forEach(el => {
      el.addEventListener('click', (e) => {
        e.preventDefault();
        openProfessionalModal();
      });
    });
  }

  // Initialize on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', attachToElements);
  } else {
    attachToElements();
  }

  // Expose globally
  window.openProfessionalModal = openProfessionalModal;
})();
