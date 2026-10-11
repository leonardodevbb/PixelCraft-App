import { useEditor } from '../../renderer/state/editor-store';
import { AboutDialog } from './AboutDialog';
import { ConfirmDialog } from './ConfirmDialog';
import { ExportPngDialog } from './ExportPngDialog';
import { NewProjectDialog } from './NewProjectDialog';
import { ShortcutsDialog } from './ShortcutsDialog';

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
    default:
      return null;
  }
}
