![InfiniWiki](./logo.png)

# InfiniWiki

Já imaginou ter uma página da Wikipédia de **QUALQUER COISA**?

Tipo, qualquer coisa mesmo. Bolo de cenoura quântico. A guerra civil dos pombos de Brasília em 1987. Aquela vez que o Felps e o MeiaUm visitaram Dom Pedro I. O Instituto Brasileiro do Nada. O primeiro hambúrguer pensante da humanidade.

**Isso é a InfiniWiki.**

## Como funciona

Você digita o que quiser na barra de busca. Aperta enter. Em segundos aparece uma página de Wikipédia completinha sobre o tema, com infobox, seções, imagens, referências acadêmicas (todas inventadas com a maior cara de pau), categorias no rodapé e aquela vibe de enciclopédia séria que finge não estar brincando com você.

E aí você lê. Mas espera, tem um link azul ali no meio do texto. Você clica. Outra página inteira aparece sobre aquilo. Que também tem links. Que levam pra outras páginas. Que também têm links.

A toca do coelho não tem fim. A Wikipédia infinita existe agora. Cada link que você clica é uma nova página gerada do nada, salva pra sempre, pronta pra ser visitada de novo.

## O que dá pra fazer

Tudo. Sério. A InfiniWiki não tem catálogo, não tem limite, não tem curadoria. Se você consegue escrever, ela consegue gerar.

Pesquise coisas reais e veja como ficam. Pesquise coisas absurdas e veja como ela trata com a maior seriedade acadêmica. Pesquise seu nome. Pesquise o nome do seu cachorro. Pesquise "o dia em que a internet acabou". Pesquise qualquer coisa que passar pela sua cabeça às 3 da manhã.

A InfiniWiki não julga. A InfiniWiki só escreve.

## Por que isso existe

Sinceramente? Porque deu vontade.

Aproveite.

## Como rodar localmente

### Pré-requisitos

- [Node.js](https://nodejs.org/) 18+ (recomendado 20+)
- [pnpm](https://pnpm.io/installation) (o projeto usa `pnpm-lock.yaml`)
- Uma chave de API do [Google Gemini](https://aistudio.google.com/app/apikey) (gratuita)

### 1. Clonar o repositório

```bash
git clone https://github.com/ctresb/infiniwiki.git
cd infiniwiki
```

### 2. Instalar dependências

```bash
pnpm install
```

Se você não tem o pnpm, instale com:

```bash
npm install -g pnpm
```

(Dá pra usar `npm install` ou `yarn` também, mas o lockfile é do pnpm.)

### 3. Configurar variáveis de ambiente

Copie o arquivo de exemplo:

```bash
cp .env.example .env
```

Abra o `.env` no seu editor favorito e preencha:

```env
VITE_GEMINI_API_KEY=cole_sua_chave_aqui
VITE_API_URL=http://localhost:3001
```

- `VITE_GEMINI_API_KEY` — pegue em https://aistudio.google.com/app/apikey. Sem ela nada gera.
- `VITE_API_URL` — URL do servidor de cache. Deixe `http://localhost:3001` pra rodar local.

### 4. Rodar em modo desenvolvimento

```bash
pnpm dev
```

Isso sobe dois processos em paralelo:

- **Vite** (frontend) em `http://localhost:5173`
- **API/servidor de cache** em `http://localhost:3001`

Abra `http://localhost:5173` no navegador. Pronto.

### 5. Build de produção

```bash
pnpm build
pnpm preview
```

O `build` gera os arquivos estáticos em `dist/`. O `preview` serve eles localmente pra testar.

### Problemas comuns

- **Página em branco / nada gera:** confira se a `VITE_GEMINI_API_KEY` está preenchida no `.env` e reinicie o `pnpm dev` (variáveis Vite só carregam no boot).
- **Erro de conexão com API:** garanta que `VITE_API_URL` aponta pra porta certa e que o servidor subiu (logs em verde no terminal).
- **Cota da Gemini esgotada:** a key gratuita tem limite por minuto. Espera um pouco ou usa outra chave.

<p align="center">
  <a href="https://feitonobrasil.dev.br" aria-label="Feito no Brasil">
    <img src="https://selo.feitonobrasil.dev.br/pt-br/branco/1x.svg" alt="Feito no Brasil" width="250" height="120" loading="lazy" />
  </a>
</p>
