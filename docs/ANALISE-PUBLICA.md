# Análise pública de referência

Levantamento feito em novembro de 2026 sobre as páginas **públicas** de um serviço estabelecido de recuperação de reembolsos (`getida.com` e as telas de acesso em `new.getida.com`), para entender o que um seller espera de um produto desta categoria.

**Escopo e limites.** Foram vistas apenas páginas abertas a qualquer visitante, com um navegador comum. Nenhuma autenticação foi contornada, nenhuma área restrita foi acessada e nenhum formulário foi enviado. Nenhum código, texto, imagem ou logotipo foi copiado: a Grandir tem nome, marca, redação e implementação próprios. A direção visual, por outro lado, segue deliberadamente a linguagem de design da referência — ver "Direção visual" abaixo. O portal interno da Grandir foi projetado de forma independente, a partir dos requisitos abaixo e de práticas comuns do setor.

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

## Direção visual

Por decisão do dono do produto, a interface da Grandir adota a mesma linguagem de design da referência, a partir de um guia de padrões levantado sobre as páginas públicas dela.

**Adotado da referência**

| Elemento | Na Grandir |
| --- | --- |
| Paleta | Ouro `#DF861D` como cor primária, marca-texto âmbar `#F6C878`, superfícies creme `#F4EFEB` / `#FAF6F0`, carvão `#1E2022`, texto em tons de ardósia |
| Paleta estendida | Três famílias secundárias — lilás/roxo `#7C3AED`, verde `#10B981` e azul `#2563EB` —, cada uma com tom vibrante, superfície pastel, marca-texto e tinta escura |
| Sistema de quatro cores | Grupos de quatro itens recebem ouro, azul, lilás e verde; marca-textos coloridos nos títulos; acento superior colorido em cards |
| Tipografia | Inter na interface; Barlow Condensed 800 em caixa alta nos títulos de impacto |
| Geometria | Botões pílula nos CTAs, cantos de 8 px em campos e 12–16 px em cards |
| Padrões | Palavra-chave grifada no título, passos em círculos numerados, seta que avança no hover |
| Login | Card único centralizado sobre fundo radial quente, rodapé fora do card |
| Cadastro | Tela dividida: painel creme de marca à esquerda, formulário em duas colunas à direita |
| Site | Navegação clara fixa, seções alternando branco, creme e carvão; faixa em movimento contínuo, manifesto, pilares, público, bloco de confiança com número monumental, FAQ e rodapé em colunas |
| Ícones | Biblioteca `lucide-react`, traço de 2 px |

**Mantido como próprio da Grandir**

- **Nome e logotipo:** o símbolo são barras ascendentes que terminam em folha. O chevron de 45° da referência não foi reproduzido, nem como marca-d'água — a marca-d'água usa o símbolo da Grandir.
- **Textos:** toda a redação é original e em português; slogans e a estrutura de frases da referência não foram usados.
- **Cor com significado no portal:** as quatro cores não são só decoração. Cada tipo de divergência pertence a uma categoria com cor fixa — estoque (azul), logística (lilás), tarifas (ouro) e devoluções (verde) — usada nas etiquetas, nos medidores e na landing.
- **Formas decorativas próprias:** barras e folha, tiradas do símbolo da Grandir, no lugar dos chevrons e cápsulas a 45° da referência.
- **Faixa em movimento sem logos:** mostra o que a Grandir audita. Logos de clientes e parceiros só entram quando existirem de fato e com autorização de uso de marca.
- **Número monumental verdadeiro:** "R$ 0 para começar", em vez de um percentual de resultado que a Grandir não tem como comprovar.
- **Seções deixadas de fora:** depoimentos, central de conteúdo (blog, guias, podcast), oferta promocional e newsletter — nada disso existe ainda.
- **Sem selos de terceiros:** a Grandir não é parceira certificada de nenhum marketplace e não exibe selo de parceria.
- **Sem prova social inventada:** nada de depoimentos, notas ou percentuais de resultado.
- **Ajuste de acessibilidade:** texto e links dourados usam um tom mais escuro (`#A65E0B`), porque o ouro primário não atinge contraste AA sobre branco.

**Risco a avaliar antes de ir a público.** Cores, fontes e padrões de layout são de uso livre isoladamente, mas a combinação — a mesma paleta de assinatura, a mesma tipografia e as mesmas telas, em um concorrente direto — pode ser questionada como imitação de conjunto-imagem (trade dress) ou concorrência desleal. Vale uma consulta jurídica antes do lançamento; trocar o tom primário e a fonte de títulos é uma mudança de poucos tokens em `apps/web/src/styles.css`.

## Onde a Grandir escolheu um caminho diferente

- **Idioma e mercado:** interface em português, pensada para sellers brasileiros e mais de um marketplace.
- **Sem rastreadores de terceiros:** o front-end não carrega tags de publicidade; fontes são servidas pelo próprio domínio.
- **Sem depoimentos nem estatísticas de resultado:** a Grandir ainda não tem clientes, então o site não afirma taxas de sucesso nem valores recuperados.
- **Arquitetura:** SPA em React com API JSON, em vez de páginas renderizadas no servidor.
