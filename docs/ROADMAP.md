# Roadmap

## Situação da versão 0.1.0

As seis fases do plano inicial foram implementadas:

| Fase | Conteúdo | Situação |
|---|---|---|
| 1. Fundação | Canvas, zoom e pan, ferramentas básicas, cores, desfazer, `.pixelcraft`, PNG | Pronta e testada |
| 2. Editor completo | Balde, seleções, transformações, simetria, camadas e grupos, paletas, autosave, preferências | Pronta e testada |
| 3. Animação | Linha do tempo, durações, reprodução, papel vegetal, GIF, spritesheet, sequência de PNG | Pronta e testada |
| 4. Recursos avançados | Texto, degradê, tiles e tileset, importações, mais formatos, paleta de comandos, atalhos configuráveis | Pronta e testada |
| 5. Distribuição | .deb, AppImage, Flatpak | Os três gerados e iniciados; .deb e AppImage também aqui, Flatpak no CI |
| 6. Estabilização | Acessibilidade, documentos grandes, recuperação, memória, primeiros passos, documentação | Pronta e testada |

## Limitações conhecidas

Estas partes do pedido original não foram feitas, ou foram feitas de forma
mais simples:

* **Flatpak só gerado no CI.** O Flathub estava bloqueado no ambiente de
  desenvolvimento. O CI do GitHub gera, instala e inicia o pacote (veja
  [BUILD_LINUX.md](BUILD_LINUX.md#flatpak)); a suíte de interface ainda não
  roda contra ele.
* **Pré-visualização em janela separada.** A pré-visualização fica no painel
  lateral, não numa janela independente.
* **Paletas.** Paletas podem ser guardadas com um nome em "Minhas paletas",
  carregadas em qualquer projeto e excluídas. Renomear ou duplicar uma
  paleta já guardada não tem botão próprio.
* **Texto.** Fontes do sistema e TTF/OTF/WOFF carregadas viram pixels sem
  suavização, mas a fonte carregada vale só até fechar o app (não fica salva
  no projeto). Não há importação de fontes BDF.
* **Tiles.** Há grade, mosaico e exportação de tileset com mapa do Tiled. Não
  há um modo de edição de mapa de tiles nem paleta de tiles para pintar.
  Camadas de tilemap de arquivos `.aseprite` abrem como pixels comuns.
* **Importar imagem.** Uma imagem abre como novo projeto ou entra como
  camada; uma spritesheet vira quadros. Não há opção de redimensionar na
  importação.
* **Formatos animados.** Há GIF e APNG. Não há WebP animado, vídeo ou PSD. O
  GIF reduz as cores com median cut, sem pontilhado.
* **Arquivos do Aseprite.** Abre RGB, tons de cinza e indexado; salva sempre em
  RGBA. Slices, dados de usuário de camadas e células, e a ordem z por célula
  são ignorados.
* **Modo indexado.** Os pixels continuam guardados em RGBA e o editor garante
  que sejam cores da paleta. Mesclar camadas com modos de mesclagem pode criar
  cores fora da paleta até a próxima edição.
* **Recursos do Aseprite ainda ausentes.** Scripts Lua e extensões, slices
  (9-slice e pivô), camada de fundo, curvas de cor, exportação pela linha de
  comando e pré-visualização em janela flutuante.
* **Idioma.** A interface está só em português.
* **Arquiteturas.** Os pacotes foram gerados e testados só para x86_64.
* **AppImage e associação de arquivos.** O AppImage não registra a extensão
  `.pixelcraft` sozinho; isso depende de uma ferramenta de integração.
* **Flatpak e arquivos ao lado.** O `.json` da spritesheet e o `.tmj` do
  tileset só são gravados quando a exportação vai para Imagens, Documentos ou
  Downloads.
* **Canvas e leitores de tela.** Menus, painéis e diálogos têm nomes
  acessíveis e passam na auditoria WCAG AA, mas desenhar continua sendo uma
  tarefa visual (de mouse ou mesa digitalizadora).

## Próximas ideias

1. Modo de mapa de tiles com paleta de tiles e tiles espelhados.
2. Exportação de WebP animado e GIF com pontilhado.
3. Slices com 9-slice e pivô na exportação da spritesheet.
4. Exportação pela linha de comando para pipelines de jogos.
5. Importação de fontes BDF e mais fontes bitmap incluídas.
6. Pré-visualização em janela flutuante.
7. Pacotes arm64 e publicação no Flathub.
8. Tradução da interface (inglês e espanhol).
