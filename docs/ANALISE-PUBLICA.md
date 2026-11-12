# Análise pública de referência

Levantamento feito em novembro de 2026 sobre as páginas **públicas** de um serviço estabelecido de recuperação de reembolsos (`getida.com` e as telas de acesso em `new.getida.com`), para entender o que um seller espera de um produto desta categoria.

**Escopo e limites.** Foram vistas apenas páginas abertas a qualquer visitante, com um navegador comum. Nenhuma autenticação foi contornada, nenhuma área restrita foi acessada e nenhum formulário foi enviado. Nenhum código, texto, imagem ou elemento de marca foi copiado: a Grandir tem identidade, redação e implementação próprias. O portal interno da Grandir foi projetado de forma independente, a partir dos requisitos abaixo e de práticas comuns do setor.

A ferramenta "REA MCP" pedida para esta etapa não estava conectada à sessão; a inspeção foi feita com o navegador integrado.

## O que foi observado

### Estrutura técnica

| Camada | Observação |
| --- | --- |
| Site institucional | WordPress, conteúdo renderizado no servidor, várias tags de marketing e rastreamento |
| Portal | Aplicação separada em subdomínio próprio; telas de acesso renderizadas no servidor com formulário HTML tradicional |
| Login | E-mail, senha e opção de manter a sessão; links para recuperar senha e criar conta |
| Cadastro | Formulário único com dados pessoais e da empresa, país de atendimento, faixa de faturamento, aceite de termos e CAPTCHA por imagem |
| Política de senha | Mínimo de 12 caracteres com maiúscula, minúscula, dígito e caractere especial |

### Navegação pública

Home, "como ajudamos", sobre, recursos (blog, vídeo, podcast, eventos, guias), enterprise, parceiros, contato, entrar e cadastrar.

### Proposta de produto

- **Onboarding em três passos:** criar conta → conectar a primeira loja → a auditoria começa.
- **Processo em quatro etapas:** auditar continuamente, documentar, gerir chamados, reinvestir o valor recuperado.
- **Janela de auditoria:** histórico retroativo e, depois, acompanhamento contínuo.
- **Tipos de divergência anunciados:** estoque perdido, danificado ou descartado em armazém, falta em remessa de entrada (inclusive reabertura de casos negados), ordem de remoção não entregue, frete cancelado e não estornado, tarifa cobrada a maior por medidas erradas, devolução atribuída ao SKU errado e perda em transferência entre centros.
- **Documentação:** parte relevante dos casos depende de comprovante de propriedade do estoque e comprovante de entrega; o serviço avisa o seller quando falta algo.
- **Preço:** sem adesão nem mensalidade; taxa de sucesso sobre o valor recuperado.
- **Segmentos:** pequenos sellers, marcas enterprise e agências.

## Como isso orientou a Grandir

| Requisito identificado | Decisão na Grandir |
| --- | --- |
| Onboarding curto | Cadastro em uma tela e, em seguida, conexão da loja com auditoria imediata |
| Auditoria contínua e reexecutável | Motores puros e idempotentes: reexecutar não duplica divergências |
| Vários tipos de divergência | Oito detectores independentes, cada um com prazo de espera e janela de contestação |
| Transparência do valor apurado | Toda divergência guarda a memória de cálculo em linguagem clara |
| Dependência de documentos | Situação "aguardando documentos", alerta no painel e anexos por chamado |
| Reabertura de casos negados | Transição `DENIED → REOPENED → UNDER_REVIEW` no ciclo de vida |
| Cobrança por sucesso | Fatura mensal calculada linha a linha sobre reembolsos pagos |
| Agências e equipes | Conta multiusuário com quatro papéis |
| Política de senha forte | Mesmo patamar (12+ caracteres, quatro classes), somado a 2FA e bloqueio por tentativas |

## Onde a Grandir escolheu um caminho diferente

- **Identidade visual própria:** paleta tinta-noite, verde-floresta e verde-broto sobre fundo areia; tipografia Manrope e Inter; marca de barras ascendentes com folha.
- **Idioma e mercado:** interface em português, pensada para sellers brasileiros e mais de um marketplace.
- **Sem rastreadores de terceiros:** o front-end não carrega tags de publicidade; fontes são servidas pelo próprio domínio.
- **Sem depoimentos nem estatísticas de resultado:** a Grandir ainda não tem clientes, então o site não afirma taxas de sucesso nem valores recuperados.
- **Arquitetura:** SPA em React com API JSON, em vez de páginas renderizadas no servidor.
