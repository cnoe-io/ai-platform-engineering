/* CAIPE Keycloak Login Theme */

/* Dark background matching the CAIPE UI */
.login-pf body,
body.kc-body {
  background: {{ .Values.theme.colors.background }} !important;
}

/* Card styling */
#kc-form-login,
.card-pf,
#kc-login {
  border-radius: 12px;
  box-shadow: {{ .Values.theme.colors.cardShadow }};
}

/* Primary button color (teal accent from CAIPE) */
#kc-login input[type="submit"],
.btn-primary {
  background-color: {{ .Values.theme.colors.primary }} !important;
  border-color: {{ .Values.theme.colors.primary }} !important;
  border-radius: 8px;
  font-weight: 600;
  text-transform: none;
  padding: 10px 20px;
  transition: background-color 0.2s ease;
}

#kc-login input[type="submit"]:hover,
.btn-primary:hover {
  background-color: {{ .Values.theme.colors.primaryHover }} !important;
  border-color: {{ .Values.theme.colors.primaryHover }} !important;
}

/* Social / IdP button styling */
#kc-social-providers .zocial {
  border-radius: 8px;
  font-weight: 500;
  border: 1px solid {{ .Values.theme.colors.socialBorder }};
  background: {{ .Values.theme.colors.socialBackground }};
  color: {{ .Values.theme.colors.socialText }};
  transition: background 0.2s ease, border-color 0.2s ease;
}

#kc-social-providers .zocial:hover {
  background: {{ .Values.theme.colors.socialHoverBackground }};
  border-color: {{ .Values.theme.colors.primary }};
  color: {{ .Values.theme.colors.socialHoverText }};
}

/* Replace Keycloak logo with the configured theme logo */
#kc-header-wrapper {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding-bottom: 20px;
}

div.kc-logo-text {
  background-image: none !important;
  height: auto !important;
  width: auto !important;
}

div.kc-logo-text::before {
  content: "";
  display: block;
  width: 80px;
  height: 80px;
  background: url("../img/logo.svg") no-repeat center / contain;
  margin: 0 auto 12px;
}

div.kc-logo-text span {
  font-size: 0;
}

div.kc-logo-text span::after {
  content: {{ .Values.theme.brandName | quote }};
  display: block;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  font-size: 2rem;
  font-weight: 700;
  color: {{ .Values.theme.colors.primary }};
  letter-spacing: 0.05em;
}

/* Form inputs */
.login-pf .form-control,
input[type="text"],
input[type="password"] {
  border-radius: 6px;
  border: 1px solid {{ .Values.theme.colors.inputBorder }};
  padding: 8px 12px;
}

/* "Or sign in with" divider */
#kc-social-providers h4 {
  color: {{ .Values.theme.colors.dividerText }};
  font-weight: 400;
  font-size: 0.9rem;
}

/* Alert/error styling */
.alert-error {
  border-radius: 8px;
  border-color: {{ .Values.theme.colors.alertErrorBorder }};
}
