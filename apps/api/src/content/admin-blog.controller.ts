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
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AuditAction } from '../audit/audit.decorator';
import { AuditInterceptor } from '../audit/audit.interceptor';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { ALLOWED_IMAGE_MIME_TYPE_PATTERN } from '../common/trusted-image-upload';
import { ContentService } from './content.service';
import {
  AdminBlogPostQueryDto,
  CreateBlogCategoryDto,
  CreateBlogPostDto,
  UpdateBlogCategoryDto,
  UpdateBlogPostDto,
} from './dto/blog.dto';

@Controller('admin/blog')
@UseGuards(RolesGuard)
@Roles('admin')
export class AdminBlogController {
  constructor(private readonly content: ContentService) {}

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
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateBlogPostDto) {
    return this.content.updatePost(id, dto);
  }

  @Post('posts/:id/publish')
  @HttpCode(200)
  @UseInterceptors(AuditInterceptor)
  @AuditAction('post.publish', 'post')
  publish(@Param('id', ParseUUIDPipe) id: string) {
    return this.content.publishPost(id);
  }

  @Post('posts/:id/unpublish')
  @HttpCode(200)
  @UseInterceptors(AuditInterceptor)
  @AuditAction('post.unpublish', 'post')
  unpublish(@Param('id', ParseUUIDPipe) id: string) {
    return this.content.unpublishPost(id);
  }

  @Delete('posts/:id')
  @HttpCode(204)
  @UseInterceptors(AuditInterceptor)
  @AuditAction('post.delete', 'post')
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.content.deletePost(id);
  }

  @Post('posts/:id/cover')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024 } }), AuditInterceptor)
  @AuditAction('post.cover.upload', 'post')
  uploadCover(
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
  ) {
    return this.content.setCover(id, file);
  }

  @Delete('posts/:id/cover')
  @HttpCode(204)
  @UseInterceptors(AuditInterceptor)
  @AuditAction('post.cover.remove', 'post')
  removeCover(@Param('id', ParseUUIDPipe) id: string) {
    return this.content.clearCover(id);
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
  updateCategory(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateBlogCategoryDto) {
    return this.content.updateCategory(id, dto);
  }

  @Delete('categories/:id')
  @HttpCode(204)
  @UseInterceptors(AuditInterceptor)
  @AuditAction('blogcategory.delete', 'blogcategory')
  removeCategory(@Param('id', ParseIntPipe) id: number) {
    return this.content.deleteCategory(id);
  }
}
