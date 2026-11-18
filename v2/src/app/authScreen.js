import { h, clear } from '../core/dom.js';
import { button, card, field, input, singleFlight, toast } from '../ui/components.js';
import { icon } from '../ui/icons.js';

// One request at a time per form, with errors shown as a message instead of thrown.
const run = (fn) => singleFlight(async () => {
  try { await fn(); } catch (error) { toast(error.message || 'Something went wrong.', 'error'); }
});

export function renderAuthScreen(root, { auth, session, refresh }) {
  clear(root);
  const stack = h('div', { class: 'auth-card' },
    h('div', { class: 'auth-brand' },
      h('span', { class: 'brand-mark' }, icon('wallet', { size: 24 })),
      h('div', null, h('h1', { class: 'auth-title' }, 'SmartFinance'), h('p', { class: 'hint' }, 'Your household finances, together.'))));
  root.append(h('main', { class: 'auth-wrap' }, stack));

  if (auth.mode === 'local') return stack.append(localForm(auth));
  if (session && !session.householdId) return stack.append(...householdForms(auth, refresh));
  return stack.append(cloudForm(auth));
}

function localForm(auth) {
  const name = input({ type: 'text', maxlength: 60, required: true, placeholder: 'e.g. Shubham' });
  return card({ title: 'Who is using the app?', subtitle: 'Local mode: data stays on this device.' },
    h('form', { class: 'form', onSubmit: run(() => auth.signIn({ displayName: name.value })) },
      field('Your name', name, 'Add a second name later to try the two-person views.'),
      button('Continue', { type: 'submit', class: 'primary', icon: 'check' })));
}

function cloudForm(auth) {
  const email = input({ type: 'email', required: true, autocomplete: 'email' });
  const password = input({ type: 'password', required: true, minlength: 8, autocomplete: 'current-password' });
  return card({ title: 'Welcome back', subtitle: 'Sign in or create an account.' },
    h('form', { class: 'form', onSubmit: run(() => auth.signIn({ email: email.value, password: password.value })) },
      field('Email', email), field('Password', password, 'At least 8 characters'),
      h('div', { class: 'actions' },
        button('Sign in', { type: 'submit', class: 'primary' }),
        button('Create account', {
          onClick: run(async () => {
            if (!email.reportValidity() || !password.reportValidity()) return;
            const { needsConfirmation } = await auth.signUp({ email: email.value, password: password.value });
            toast(needsConfirmation ? 'Check your email to confirm, then sign in.' : 'Account created.', 'success');
          }),
        }))));
}

function householdForms(auth, refresh) {
  // If the account already belongs to a household (e.g. an earlier request succeeded), that is
  // the outcome the user wanted: carry on into the app instead of showing an error.
  const finish = async (action) => {
    try {
      await action();
    } catch (error) {
      if (!/already in a household/i.test(error.message)) throw error;
    }
    await refresh();
  };
  const myName = input({ type: 'text', maxlength: 60, required: true, placeholder: 'Your name' });
  const householdName = input({ type: 'text', maxlength: 80, required: true, value: 'Our household' });
  const code = input({ type: 'text', maxlength: 32, required: true, placeholder: 'Invite code', autocomplete: 'off' });
  const joinName = input({ type: 'text', maxlength: 60, required: true, placeholder: 'Your name' });

  return [
    card({ title: 'Start a household', subtitle: 'You’ll get an invite code to share.' },
      h('form', { class: 'form', onSubmit: run(() => finish(() => auth.createHousehold({ name: householdName.value, displayName: myName.value }))) },
        field('Household name', householdName), field('Your name', myName),
        button('Create household', { type: 'submit', class: 'primary' }))),
    card({ title: 'Join your partner’s household' },
      h('form', { class: 'form', onSubmit: run(() => finish(() => auth.joinHousehold({ code: code.value, displayName: joinName.value }))) },
        field('Invite code', code),
        field('Your name', joinName, 'How the others will see you. Capitals don’t matter, but each person needs a different name.'),
        button('Join household', { type: 'submit', class: 'primary' }))),
    button('Sign out', { class: 'ghost', icon: 'logout', onClick: () => auth.signOut() }),
  ];
}
