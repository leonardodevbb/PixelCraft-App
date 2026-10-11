import { useEditor } from '../../renderer/state/editor-store';
import { AboutDialog } from './AboutDialog';
import { ConfirmDialog } from './ConfirmDialog';
import { ExportPngDialog } from './ExportPngDialog';
import { NewProjectDialog } from './NewProjectDialog';
import { ShortcutsDialog } from './ShortcutsDialog';
import { OffsetDialog, ReplaceColorDialog, ResizeCanvasDialog, ResizeContentDialog, ScaleSelectionDialog } from './ImageDialogs';
import { LayerPropertiesDialog } from './LayerPropertiesDialog';
import { PaletteToolsDialog } from './PaletteToolsDialog';
import { PreferencesDialog } from './PreferencesDialog';
import { PromptDialog } from './PromptDialog';
import { CommandPalette } from './CommandPalette';
import { ImportSpritesheetDialog } from './ImportSpritesheetDialog';
import { AnimationExportDialog } from './AnimationExportDialog';

export function DialogHost() {
  const d = useEditor((s) => s.dialog);
  if (!d) return null;
  switch (d.type) {
    case 'new-project':
      return <NewProjectDialog />;
    case 'export-png':
      return <ExportPngDialog />;
    case 'about':
      return <AboutDialog />;
    case 'shortcuts':
      return <ShortcutsDialog />;
    case 'confirm':
      return <ConfirmDialog d={d} />;
    case 'prompt':
      return <PromptDialog d={d} />;
    case 'resize-canvas':
      return <ResizeCanvasDialog />;
    case 'resize-content':
      return <ResizeContentDialog />;
    case 'offset':
      return <OffsetDialog />;
    case 'replace-color':
      return <ReplaceColorDialog />;
    case 'scale-selection':
      return <ScaleSelectionDialog />;
    case 'layer-properties':
      return <LayerPropertiesDialog layerId={d.layerId} />;
    case 'palette-tools':
      return <PaletteToolsDialog />;
    case 'export-gif':
      return <AnimationExportDialog kind="gif" />;
    case 'export-sequence':
      return <AnimationExportDialog kind="sequence" />;
    case 'export-spritesheet':
      return <AnimationExportDialog kind="spritesheet" />;
    case 'import-spritesheet':
      return <ImportSpritesheetDialog file={d.file} />;
    case 'command-palette':
      return <CommandPalette />;
    case 'preferences':
      return <PreferencesDialog />;
    default:
      return null;
  }
}
