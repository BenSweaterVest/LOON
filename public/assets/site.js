// Progressive enhancement for public pages: the feedback form.
const section = document.querySelector('.feedback[data-page]');
if (section) {
    section.hidden = false;
    const form = section.querySelector('form');
    const status = section.querySelector('.feedback-status');
    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const button = form.querySelector('button');
        const data = Object.fromEntries(new FormData(form));
        button.disabled = true;
        status.textContent = 'Sending...';
        try {
            const res = await fetch('/api/feedback', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ pageId: section.dataset.page, ...data })
            });
            const body = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(body.error || 'Could not send feedback');
            form.reset();
            status.textContent = 'Thanks! Your feedback was sent.';
        } catch (err) {
            status.textContent = err.message;
        } finally {
            button.disabled = false;
        }
    });
}
