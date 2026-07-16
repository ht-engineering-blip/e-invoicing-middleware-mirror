import fs from 'fs';
import path from 'path';
import Handlebars from 'handlebars';
import { EMBEDDED_TEMPLATES } from './rawTemplates';

class TemplateEngine {
  private cache = new Map<string, HandlebarsTemplateDelegate>();
  private templatesDir = import.meta.dir;

  /**
   * Render a Handlebars template dynamically with in-memory caching.
   * Supports local live-reloads, serverless project standard paths, and embedded precompiled fallbacks.
   * 
   * @param templateName - The filename of the template without extension (e.g. 'resetPassword')
   * @param context - The variables to interpolate into the template
   */
  render(templateName: string, context: Record<string, any> = {}): string {
    if (templateName.includes('..') || path.isAbsolute(templateName)) {
      throw new Error(`Invalid template name: ${templateName}`);
    }

    let compiled = this.cache.get(templateName);

    if (!compiled) {
      let source: string | undefined;

      // 1. Try resolving relative to import.meta.dir (local runtime file system)
      try {
        const localPath = path.join(this.templatesDir, `${templateName}.hbs`);
        if (fs.existsSync(localPath)) {
          source = fs.readFileSync(localPath, 'utf-8');
        }
      } catch (err) {
        // Fall through to other resolution paths
      }

      // 2. Try resolving relative to process.cwd() (serverless Node File Trace root standard)
      if (!source) {
        try {
          const cwdPath = path.join(process.cwd(), 'src', 'templates', `${templateName}.hbs`);
          if (fs.existsSync(cwdPath)) {
            source = fs.readFileSync(cwdPath, 'utf-8');
          }
        } catch (err) {
          // Fall through to embedded templates
        }
      }

      // 3. Fall back to preloaded embedded template strings (absolute serverless protection)
      if (!source) {
        source = EMBEDDED_TEMPLATES[templateName];
      }

      if (!source) {
        throw new Error(`Template not found: ${templateName}`);
      }

      compiled = Handlebars.compile(source);
      this.cache.set(templateName, compiled);
    }

    return compiled(context);
  }

  /**
   * Render an inline template string with in-memory caching.
   * 
   * @param cacheKey - Unique key to cache the compiled template
   * @param source - The raw Handlebars template string
   * @param context - The variables to interpolate into the template
   */
  renderInline(cacheKey: string, source: string, context: Record<string, any> = {}): string {
    let compiled = this.cache.get(cacheKey);

    if (!compiled) {
      compiled = Handlebars.compile(source);
      this.cache.set(cacheKey, compiled);
    }

    return compiled(context);
  }
}

export const templateEngine = new TemplateEngine();
