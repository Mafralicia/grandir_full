# Próximos passos

Roteiro para colocar o Grandir em produção, com as pendências de segurança da revisão de
13/11/2026. A ordem é a recomendada; cada item diz o que falta e por que importa.

## Roteiro

| # | Passo | Situação |
| --- | --- | --- |
| 1 | Pacote de deploy (build, Docker, backup, CI) | **Feito** — ver [DEPLOY.md](DEPLOY.md). A imagem Docker não foi construída localmente |
| 2 | E-mail transacional (Resend, Amazon SES ou Postmark) | **Pendente** — falta escolher o provedor. Bloqueia S1 e S2 abaixo |
| 3 | Hospedagem com disco persistente, HTTPS e backup fora da máquina | Pendente |
| 4 | Registrar os aplicativos nos marketplaces (Mercado Livre primeiro) | Pendente — depende de você; ver [INTEGRACOES.md](INTEGRACOES.md) |
| 5 | Piloto com um seller real | Pendente |
| 6 | Conferir as tabelas de tarifas em fonte oficial (`verified: false`) | Pendente |
| 7 | Termos de uso, política de privacidade e CAPTCHA | Pendente |
| 8 | Gateway de pagamento para a taxa de sucesso | Pendente |

## Segurança

### O que a revisão confirmou

Revisão do código inteiro da branch `feat/grandir-platform`. Sem falha explorável em: isolamento
entre contas (todo identificador vindo da requisição é resolvido com o filtro da conta), SQL
(tudo parametrizado), papéis, sessão e CSRF, OAuth (`state` de uso único, preso a conta e usuário),
criptografia (AES-256-GCM, scrypt, TOTP com proteção contra repetição), upload e download de
anexos, leitura de XML de NF-e, exportações CSV/XLSX e exportação da conta (sem segredos).

### Corrigido

- **S1 — Links de redefinição de senha e de convite iam para o log em texto puro** (média).
  Em produção, quem lesse o log podia pedir a redefinição de qualquer e-mail, copiar o token e
  assumir a conta. Agora: o remetente que escreve o corpo no log só existe fora de produção; em
  produção a aplicação recusa iniciar sem `EMAIL_DELIVERY=disabled`, e com ela registra apenas
  destinatário e assunto. **Continua pendente** o envio real (passo 2): até lá, redefinição de
  senha e convites não funcionam em produção.

### Antes de abrir o cadastro ao público

- **S2 — Cadastro sem confirmação de e-mail.** Qualquer pessoa cria conta com o e-mail de outra, e
  como o e-mail é único, o dono verdadeiro fica impedido de se cadastrar. Depende do passo 2.
- **S3 — O cadastro revela quem é cliente.** A resposta `EMAIL_EM_USO` permite testar e-mails.
  Trocar por resposta neutra ("enviamos um e-mail") junto com o S2.
- **S4 — Convite cria o usuário na hora.** Um administrador de qualquer conta pode convidar um
  e-mail ainda não cadastrado (`POST /api/team`, `apps/api/src/routes/portal.ts:546`); a pessoa
  não consegue mais criar a própria conta e, ao redefinir a senha, entra na conta de quem a
  convidou. Trocar por convite pendente, que só vira usuário quando aceito.
- **S5 — Sem CAPTCHA** no cadastro, no login e no "esqueci a senha" (há limite de taxa e
  campo-isca). Faz parte do passo 7.
- **S6 — Bloqueio por conta pode ser usado contra a vítima.** Cinco senhas erradas travam o
  login daquele e-mail por 15 minutos, para qualquer origem. Trocar por atraso progressivo ou
  bloqueio por par e-mail + origem.
- **S7 — Tokens antigos continuam válidos.** Redefinir ou trocar a senha não invalida outros
  links de redefinição ou convite ainda pendentes do mesmo usuário (são de uso único e expiram).

### Antes de cobrar clientes

- **S8 — Não existe administração da plataforma.** A equipe do Grandir não tem como ver contas,
  desativar uma conta abusiva ou ajustar a taxa. Papéis (Titular, Administrador, Analista,
  Leitor) valem só dentro de cada conta.
- **S9 — O seller declara o próprio resultado.** O status "pago" e o valor reembolsado, sobre os
  quais a taxa de sucesso é cobrada, são informados pelo cliente, sem conferência. Conferir com o
  extrato importado ou com a API antes de faturar.

### Reforços

- **S10 — Chave de desenvolvimento fora de produção.** Sem `NODE_ENV=production`, o servidor
  usa uma chave de cifra fixa do código e cookie sem `Secure` (`apps/api/src/config.ts`). A
  imagem Docker define a variável; o risco é subir o processo à mão sem ela. Recusar iniciar
  com a chave padrão quando `HOST` não for local.
- **S11 — Monitoramento de erros e alertas** (logins falhos em massa, falhas de sincronização).
- **S12 — Uma instância e SQLite.** Escalar exige PostgreSQL (com RLS como segunda barreira de
  isolamento) e fila de tarefas.
