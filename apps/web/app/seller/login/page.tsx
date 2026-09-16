import { LoginForm } from '../../../components/seller/forms';
export default function Page() {
  return (
    <section className="seller-login">
      <p className="eyebrow">QRG BUSINESS</p>
      <h1>Кабинет продавца</h1>
      <p>Войдите, чтобы управлять своим магазином.</p>
      <LoginForm />
    </section>
  );
}
