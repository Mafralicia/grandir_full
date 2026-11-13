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
 * Só para desenvolvimento local: escreve a mensagem inteira no log em vez de enviar, para que o
 * link de redefinição ou de convite possa ser copiado. Nunca use em produção — o corpo traz
 * tokens que dão acesso à conta.
 */
export function consoleMailer(log: (message: string) => void): Mailer {
  return {
    async send(mail) {
      log(`[e-mail não enviado — modo desenvolvimento]\nPara: ${mail.to}\nAssunto: ${mail.subject}\n\n${mail.text}`);
    },
  };
}

/**
 * Envio desligado: descarta a mensagem e registra apenas destinatário e assunto. O corpo (e o
 * token que ele carrega) não é gravado em lugar nenhum.
 */
export function discardMailer(log: (message: string) => void): Mailer {
  return {
    async send(mail) {
      log(`[e-mail não enviado — envio desligado] Para: ${mail.to} | Assunto: ${mail.subject}`);
    },
  };
}
