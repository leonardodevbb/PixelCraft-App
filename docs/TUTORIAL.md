# Primeiros passos

Este guia leva uns dez minutos e termina com um sprite animado exportado como
GIF. A mesma introdução, em versão curta, aparece ao abrir o primeiro projeto
e pode ser reaberta em **Ajuda › Primeiros passos**.

## 1. Criar uma tela

Na tela inicial, clique em **Personagem 32** (32×32 pixels) ou em **Novo
projeto** para escolher outro tamanho. As predefinições estão agrupadas em
ícones, personagens, tiles, objetos e telas. Pixel art costuma começar
pequena: 16×16 ou 32×32 é um bom começo.

A tela aparece ampliada. Para navegar:

* **Roda do mouse:** zoom no ponto do cursor.
* **Espaço + arrastar** ou **botão do meio:** mover a vista.
* **Ctrl+0:** ajustar à janela. **Ctrl+1:** tamanho real.

## 2. Desenhar

1. Escolha o **Lápis** (B) na barra da esquerda.
2. Clique numa cor da **Paleta** à direita. O botão esquerdo do mouse pinta
   com a cor primária; o direito, com a secundária.
3. Desenhe o contorno do personagem. Para retas use a **Linha** (L); segure
   Shift para travar em 0°, 45° ou 90°.
4. Preencha áreas fechadas com o **Balde** (G).
5. Errou? **Ctrl+Z** desfaz um traço inteiro; **Ctrl+Y** refaz.

Dica: ligue **Espelhar ↔** na barra de opções para desenhar os dois lados do
personagem ao mesmo tempo.

## 3. Escolher cores

* No painel **Cores**, clique na amostra primária ou secundária e ajuste no
  seletor, ou digite um código HEX.
* **X** troca a primária com a secundária. Segure **Alt** sobre a tela para
  pegar uma cor que já está no desenho.
* **Imagem › Paleta › Ferramentas de paleta** mostra quantas cores você usou e
  quais estão fora da paleta.

## 4. Usar camadas

1. Clique em **+** no painel **Camadas** (ou Ctrl+Shift+N) para criar uma
   camada para o sombreamento.
2. Pinte as sombras nela. O **olho** oculta a camada e o **cadeado** impede
   alterações acidentais.
3. Arraste as camadas para reordenar. Na engrenagem você ajusta opacidade,
   modo de mesclagem e cor da etiqueta.

## 5. Animar

1. Na **linha do tempo**, embaixo, clique em **Duplicar quadro** (Alt+D). O
   novo quadro começa igual ao anterior.
2. Mude algo no novo quadro, por exemplo levante um braço.
3. Ative o **papel vegetal** (F3) para ver o quadro anterior em rosa e o
   seguinte em verde-azulado enquanto desenha.
4. Repita para 3 ou 4 quadros. Navegue com **,** e **.**.
5. Toque **Espaço** (ou Enter) para reproduzir. Clique na duração de um quadro
   (por exemplo `100ms`) para segurá-lo por mais tempo.

## 6. Salvar e exportar

* **Ctrl+S** salva um arquivo `.pixelcraft`, que guarda camadas, quadros,
  paleta e configurações. Enquanto você trabalha, o PixelCraft também guarda
  cópias automáticas; se o computador desligar, a tela inicial oferece
  recuperar o trabalho.
* **Arquivo › Exportar GIF animado** (Ctrl+Alt+G): escolha a escala (4×
  deixa um sprite de 32 px com 128 px) e veja o tamanho do arquivo antes de
  salvar.
* **Arquivo › Exportar spritesheet** (Ctrl+Alt+S): todos os quadros numa
  imagem, com um JSON que descreve posição e duração de cada quadro para
  motores de jogo.
* **Arquivo › Exportar imagem** (Ctrl+Shift+E): o quadro atual em PNG, JPEG,
  WebP ou BMP.

## Próximos passos

* **Ctrl+K** abre a paleta de comandos: digite o que quer fazer ("girar",
  "nova camada", "tileset").
* **F1** lista todos os atalhos e permite trocá-los.
* Para jogos com cenários, veja **Imagem › Tiles e tileset**: grade de tiles,
  modo mosaico (Ctrl+Shift+T) para conferir emendas e exportação para o Tiled.
