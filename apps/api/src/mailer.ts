export interface Mail {
  to: string;
  subject: string;
  text: string;
}

/** Ponto de integração com o provedor de e-mail transacional. */
export interface Mailer {
  send(mail: Mail): Promise<void>;
}

/**
 * Implementação de desenvolvimento: escreve a mensagem no log em vez de enviar.
 * Em produção, substitua por um adaptador do provedor escolhido (SES, Resend, Postmark…).
 */
export function consoleMailer(log: (message: string) => void): Mailer {
  return {
    async send(mail) {
      log(`[e-mail não enviado — modo desenvolvimento]\nPara: ${mail.to}\nAssunto: ${mail.subject}\n\n${mail.text}`);
    },
  };
}
