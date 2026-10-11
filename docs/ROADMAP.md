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
* **Transformação livre na tela.** Girar e espelhar a seleção funcionam em
  passos de 90°. Escalar a seleção usa um diálogo com vizinho mais próximo.
  Não há alças de transformação no canvas nem rotação em ângulo livre.
* **Régua.** Não há réguas nas bordas do canvas. As guias são criadas por
  posição em Visualizar › Guias e eixos de simetria; o cursor mostra X e Y na
  barra de status.
* **Linha do tempo.** Não há seleção de vários quadros ao mesmo tempo nem
  copiar e colar quadros. Duplicar, mover, marcar e definir a duração de
  todos os quadros funcionam.
* **Pré-visualização em janela separada.** A pré-visualização fica no painel
  lateral, não numa janela independente.
* **Paletas.** Paletas podem ser guardadas com um nome em "Minhas paletas",
  carregadas em qualquer projeto e excluídas. Renomear ou duplicar uma
  paleta já guardada não tem botão próprio.
* **Texto.** Há uma única fonte bitmap (PixelCraft Sans 5×7, com acentos);
  não é possível importar outras fontes.
* **Tiles.** Há grade, mosaico e exportação de tileset com mapa do Tiled. Não
  há um modo de edição de mapa de tiles nem paleta de tiles para pintar.
* **Importar imagem.** Uma imagem abre como novo projeto ou entra como
  camada; uma spritesheet vira quadros. Não há opção de redimensionar na
  importação.
* **Formatos animados.** Não há exportação de APNG ou WebP animado. O GIF
  reduz as cores com median cut, sem pontilhado.
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

1. Alças de transformação no canvas, com rotação livre (rotsprite).
2. Seleção de vários quadros, copiar e colar quadros e células.
3. Exportação de APNG e WebP animado, e GIF com pontilhado.
4. Modo de mapa de tiles com paleta de tiles e tiles espelhados.
5. Importação de fontes BDF e mais fontes bitmap incluídas.
6. Pré-visualização em janela flutuante.
7. Pacotes arm64 e publicação no Flathub.
8. Tradução da interface (inglês e espanhol).
9. Suporte a pressão de caneta para o pincel.
