import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseFilePipeBuilder,
  ParseIntPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { InjectRepository } from '@nestjs/typeorm';
import { Request } from 'express';
import { Repository } from 'typeorm';
import { AuditAction } from '../audit/audit.decorator';
import { AuditInterceptor } from '../audit/audit.interceptor';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { ALLOWED_IMAGE_MIME_TYPE_PATTERN } from '../common/trusted-image-upload';
import { BlogCategory } from './blog-category.entity';
import { BlogPost } from './blog-post.entity';
import { ContentService } from './content.service';
import {
  AdminBlogPostQueryDto,
  CreateBlogCategoryDto,
  CreateBlogPostDto,
  UpdateBlogCategoryDto,
  UpdateBlogPostDto,
} from './dto/blog.dto';

// Fields captured in before/after audit snapshots for a post edit -- deliberately
// excludes bodyMarkdown (spec guidance: full body diffs would be too large/noisy to
// store twice in an audit row) while still covering everything else an editor can change.
function postAuditSnapshot(post: BlogPost) {
  return {
    title: post.title,
    slug: post.slug,
    excerpt: post.excerpt,
    categoryId: post.categoryId,
    authorName: post.authorName,
    metaDescription: post.metaDescription,
    ogTitle: post.ogTitle,
  };
}

@Controller('admin/blog')
@UseGuards(RolesGuard)
@Roles('admin')
export class AdminBlogController {
  constructor(
    private readonly content: ContentService,
    @InjectRepository(BlogPost) private readonly posts: Repository<BlogPost>,
    @InjectRepository(BlogCategory) private readonly categories: Repository<BlogCategory>,
  ) {}

  @Get('posts')
  list(@Query() query: AdminBlogPostQueryDto) {
    return this.content.listPostsForAdmin(query);
  }

  @Get('posts/:id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.content.getPostForAdmin(id);
  }

  @Post('posts')
  @UseInterceptors(AuditInterceptor)
  @AuditAction('post.create', 'post')
  create(@Body() dto: CreateBlogPostDto) {
    return this.content.createPost(dto);
  }

  @Patch('posts/:id')
  @UseInterceptors(AuditInterceptor)
  @AuditAction('post.update', 'post')
  async update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateBlogPostDto, @Req() req: Request) {
    // Real before/after diff for AuditInterceptor (see its doc comment), scoped to
    // postAuditSnapshot() -- everything an editor can change except bodyMarkdown, which
    // is deliberately left out (too large/noisy to store twice in an audit row). Left
    // unset when the post doesn't exist -- ContentService.updatePost below still 404s
    // exactly as before, this fetch just can't contribute a "before" snapshot then.
    const before = await this.posts.findOneBy({ id });
    if (before) req.auditBefore = postAuditSnapshot(before);

    const updated = await this.content.updatePost(id, dto);
    req.auditAfter = postAuditSnapshot(updated);
    return updated;
  }

  @Post('posts/:id/publish')
  @HttpCode(200)
  @UseInterceptors(AuditInterceptor)
  @AuditAction('post.publish', 'post')
  async publish(@Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    // Real before/after status diff for AuditInterceptor (see its doc comment). Left
    // unset when the post doesn't exist -- ContentService.publishPost below still 404s
    // exactly as before.
    const before = await this.posts.findOneBy({ id });
    if (before) req.auditBefore = { status: before.status, publishedAt: before.publishedAt };

    const updated = await this.content.publishPost(id);
    req.auditAfter = { status: updated.status, publishedAt: updated.publishedAt };
    return updated;
  }

  @Post('posts/:id/unpublish')
  @HttpCode(200)
  @UseInterceptors(AuditInterceptor)
  @AuditAction('post.unpublish', 'post')
  async unpublish(@Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    // Real before/after status diff for AuditInterceptor (see its doc comment). Left
    // unset when the post doesn't exist -- ContentService.unpublishPost below still
    // 404s exactly as before.
    const before = await this.posts.findOneBy({ id });
    if (before) req.auditBefore = { status: before.status, publishedAt: before.publishedAt };

    const updated = await this.content.unpublishPost(id);
    req.auditAfter = { status: updated.status, publishedAt: updated.publishedAt };
    return updated;
  }

  @Delete('posts/:id')
  @HttpCode(204)
  @UseInterceptors(AuditInterceptor)
  @AuditAction('post.delete', 'post')
  async remove(@Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    // Real "before" snapshot for AuditInterceptor (see its doc comment). A hard delete
    // has no post-write state to report (req.auditAfter stays unset -> null), so this
    // is the only record of what the post looked like right before removal -- DELETE
    // requests carry no body, so without this the payload would otherwise be bare
    // `null`. bodyMarkdown deliberately excluded, same reasoning as postAuditSnapshot().
    const before = await this.posts.findOneBy({ id });
    if (before) req.auditBefore = { ...postAuditSnapshot(before), status: before.status };

    return this.content.deletePost(id);
  }

  @Post('posts/:id/cover')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024 } }), AuditInterceptor)
  @AuditAction('post.cover.upload', 'post')
  async uploadCover(
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile(
      new ParseFilePipeBuilder()
        // Real magic-number content-sniffing (via the `file-type` package), with no
        // mimetype-trusting fallback -- identical validator to salon photo uploads:
        // only actual file bytes matching a real image signature pass (422 otherwise).
        // file.mimetype itself is separately verified in ContentService.setCover().
        .addFileTypeValidator({ fileType: ALLOWED_IMAGE_MIME_TYPE_PATTERN })
        .build({ errorHttpStatusCode: HttpStatus.UNPROCESSABLE_ENTITY }),
    )
    file: Express.Multer.File,
    @Req() req: Request,
  ) {
    // Real before/after diff for AuditInterceptor (see its doc comment) -- shows
    // whether this replaced an existing cover (and which storage key it replaced) or
    // set the first one. Left unset when the post doesn't exist -- setCover below
    // still 404s exactly as before.
    const before = await this.posts.findOneBy({ id });
    if (before) req.auditBefore = { coverImageKey: before.coverImageKey };

    const updated = await this.content.setCover(id, file);
    req.auditAfter = { coverImageKey: updated.coverImageKey };
    return updated;
  }

  @Delete('posts/:id/cover')
  @HttpCode(204)
  @UseInterceptors(AuditInterceptor)
  @AuditAction('post.cover.remove', 'post')
  async removeCover(@Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    // Real before/after diff for AuditInterceptor (see its doc comment). Left unset
    // when the post doesn't exist -- clearCover below still 404s exactly as before.
    const before = await this.posts.findOneBy({ id });
    if (before) req.auditBefore = { coverImageKey: before.coverImageKey };

    await this.content.clearCover(id);
    req.auditAfter = { coverImageKey: null };
  }

  @Post('categories')
  @UseInterceptors(AuditInterceptor)
  @AuditAction('blogcategory.create', 'blogcategory')
  createCategory(@Body() dto: CreateBlogCategoryDto) {
    return this.content.createCategory(dto);
  }

  @Patch('categories/:id')
  @UseInterceptors(AuditInterceptor)
  @AuditAction('blogcategory.update', 'blogcategory')
  async updateCategory(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateBlogCategoryDto, @Req() req: Request) {
    // Real before/after diff for AuditInterceptor (see its doc comment). Left unset
    // when the category doesn't exist -- ContentService.updateCategory below still
    // 404s exactly as before.
    const before = await this.categories.findOneBy({ id });
    if (before) req.auditBefore = { name: before.name, slug: before.slug };

    const updated = await this.content.updateCategory(id, dto);
    req.auditAfter = { name: updated.name, slug: updated.slug };
    return updated;
  }

  @Delete('categories/:id')
  @HttpCode(204)
  @UseInterceptors(AuditInterceptor)
  @AuditAction('blogcategory.delete', 'blogcategory')
  async removeCategory(@Param('id', ParseIntPipe) id: number, @Req() req: Request) {
    // Real "before" snapshot for AuditInterceptor (see its doc comment) -- a hard
    // delete has no post-write state to report, and DELETE requests carry no body, so
    // without this the payload would otherwise be bare `null`.
    const before = await this.categories.findOneBy({ id });
    if (before) req.auditBefore = { name: before.name, slug: before.slug };

    return this.content.deleteCategory(id);
  }
}
